import AVFoundation
import ExpoModulesCore
import UIKit

/// What the editor asks for. Crop values are fractions of the displayed frame.
struct EditOptions: Record {
  @Field var startMs: Double = 0
  /// 0 = to the end
  @Field var endMs: Double = 0
  @Field var cropX: Double = 0
  @Field var cropY: Double = 0
  @Field var cropW: Double = 1
  @Field var cropH: Double = 1
  /// Largest short side in pixels; 0 = keep
  @Field var maxShortSide: Double = 0
  /// 0 = keep
  @Field var fps: Double = 0
  /// Copy the frames as they are (trim only)
  @Field var passthrough: Bool = false
  /// Make Smaller strength: keep this share of the source's video bitrate; 0 = automatic
  @Field var bitrateShare: Double = 0
}

/// The picture changes, as plain values (shared by both encoders).
struct Shape {
  var cropX: Double = 0
  var cropY: Double = 0
  var cropW: Double = 1
  var cropH: Double = 1
  var maxShortSide: Double = 0
  var fps: Double = 0

  var fullFrame: Bool { cropX <= 0 && cropY <= 0 && cropW >= 1 && cropH >= 1 }
}

/// What the backup encoder needs when Apple's exporter gives up.
struct BackupPlan {
  let asset: AVAsset
  let track: AVAssetTrack
  let timeRange: CMTimeRange
  let shape: Shape
  /// > 0: aim for this share of the source's video bitrate (Make Smaller strength).
  var bitrateShare: Double = 0
}

/// One writer input's progress; only touched on that input's own queue.
final class PumpState {
  var done = false
  var lastKept = CMTime.invalid
}

struct CompressError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// Lets a running backup encode be stopped from another thread.
final class BackupJob {
  private let lock = NSLock()
  private var stopped = false
  var cancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopped
  }
  func cancel() {
    lock.lock()
    stopped = true
    lock.unlock()
  }
}

/// "Make Smaller" and the video editor: re-encodes with Apple's exporter (the
/// same hardware HEVC encoder the Camera app uses). Trims, crops, scales and
/// lowers the frame rate through a video composition; the file's date and
/// location metadata are carried over.
///
/// Some files (game captures, clips cut by other apps) have broken frame
/// timing, e.g. a "902 fps" video, and the exporter fails on them with
/// "Cannot Complete Action". Those go through a backup encoder that reads the
/// frames itself, drops extra frames to reach the frame rate, and writes HEVC.
public class ReelVaultCompressModule: Module {
  /// Running exports by job id. Only touched on the main queue.
  private var sessions: [String: AVAssetExportSession] = [:]
  /// Running backup encodes by job id. Only touched on the main queue.
  private var backups: [String: BackupJob] = [:]

  public func definition() -> ModuleDefinition {
    Name("ReelVaultCompress")

    Events("onProgress")

    /// Presets this file can be exported with, out of the four ReelVault offers.
    AsyncFunction("supportedQualities") { (input: String) -> [String] in
      guard let url = URL(string: input) else { return [] }
      let compatible = Set(AVAssetExportSession.exportPresets(compatibleWith: AVURLAsset(url: url)))
      return ["same", "1080p", "720p", "small"].filter { compatible.contains(Self.presetName($0)) }
    }

    AsyncFunction("compress") { (input: String, output: String, quality: String, jobId: String, promise: Promise) in
      guard let inURL = URL(string: input), let outURL = URL(string: output) else {
        promise.reject("ERR_URL", "That file address could not be read.")
        return
      }
      let asset = AVURLAsset(url: inURL)
      var backup: BackupPlan? = nil
      if let track = asset.tracks(withMediaType: .video).first {
        var shape = Shape()
        shape.maxShortSide = Self.shortSide(for: quality)
        backup = BackupPlan(asset: asset, track: track, timeRange: CMTimeRange(start: .zero, duration: asset.duration), shape: shape)
      }
      guard let session = AVAssetExportSession(asset: asset, presetName: Self.presetName(quality)) else {
        if let backup = backup {
          self.runBackup(backup, outURL: outURL, jobId: jobId, promise: promise, firstError: nil)
        } else {
          promise.reject("ERR_PRESET", "This video can't be made smaller with that setting.")
        }
        return
      }
      self.run(session, asset: asset, outURL: outURL, jobId: jobId, promise: promise, backup: backup)
    }

    AsyncFunction("edit") { (input: String, output: String, options: EditOptions, jobId: String, promise: Promise) in
      guard let inURL = URL(string: input), let outURL = URL(string: output) else {
        promise.reject("ERR_URL", "That file address could not be read.")
        return
      }
      let asset = AVURLAsset(url: inURL)
      let duration = asset.duration
      let start = CMTime(seconds: max(0, options.startMs) / 1000, preferredTimescale: 600)
      let end = options.endMs > 0
        ? CMTimeMinimum(CMTime(seconds: options.endMs / 1000, preferredTimescale: 600), duration)
        : duration
      guard CMTimeCompare(end, start) > 0 else {
        promise.reject("ERR_RANGE", "The trimmed part is empty.")
        return
      }
      let timeRange = CMTimeRange(start: start, end: end)

      let shape = Shape(
        cropX: options.cropX,
        cropY: options.cropY,
        cropW: options.cropW,
        cropH: options.cropH,
        maxShortSide: options.maxShortSide,
        fps: options.fps
      )
      let track = asset.tracks(withMediaType: .video).first
      // A frame rate far above anything a camera films means broken timing:
      // always re-encode those so the result plays normally.
      let brokenRate = (track?.nominalFrameRate ?? 0) > 240
      let needsComposition = !shape.fullFrame || shape.maxShortSide > 0 || shape.fps > 0 || brokenRate
      let passthrough = options.passthrough && !needsComposition
      let share = passthrough ? 0 : min(1, max(0, options.bitrateShare))
      let backup = passthrough
        ? nil
        : track.map { BackupPlan(asset: asset, track: $0, timeRange: timeRange, shape: shape, bitrateShare: share) }

      // A chosen strength needs a bitrate, which Apple's exporter can't take: use the writer directly.
      if share > 0 {
        guard let backup = backup else {
          promise.reject("ERR_TRACK", "This file has no video picture.")
          return
        }
        self.runBackup(backup, outURL: outURL, jobId: jobId, promise: promise, firstError: nil)
        return
      }

      let preset = passthrough ? AVAssetExportPresetPassthrough : AVAssetExportPresetHEVCHighestQuality
      guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
        if let backup = backup {
          self.runBackup(backup, outURL: outURL, jobId: jobId, promise: promise, firstError: nil)
        } else {
          promise.reject("ERR_PRESET", "This video can't be edited on this iPhone.")
        }
        return
      }
      session.timeRange = timeRange

      if needsComposition {
        guard let track = track else {
          promise.reject("ERR_TRACK", "This file has no video picture.")
          return
        }
        session.videoComposition = Self.composition(for: asset, track: track, shape: shape, duration: duration)
      }
      self.run(session, asset: asset, outURL: outURL, jobId: jobId, promise: promise, backup: backup)
    }

    /// What this build's encoder can do; older builds have no such function.
    Function("features") { () -> [String] in
      ["bitrateShare"]
    }

    Function("cancel") { (jobId: String) in
      DispatchQueue.main.async {
        self.sessions[jobId]?.cancelExport()
        self.backups[jobId]?.cancel()
      }
    }
  }

  /// The frame rate to write: the one asked for (never above the source's),
  /// otherwise the source's own, with broken rates brought down to 60.
  private static func targetFps(track: AVAssetTrack, asked: Double) -> Double {
    let source = track.nominalFrameRate > 0 ? Double(track.nominalFrameRate) : 30
    if asked > 0 { return max(1, min(asked, source)) }
    return source > 240 ? 60 : source
  }

  /// The displayed size (rotation applied) and the transform that puts the frame upright at 0,0.
  private static func upright(_ track: AVAssetTrack) -> (size: CGSize, transform: CGAffineTransform) {
    let natural = track.naturalSize
    let preferred = track.preferredTransform
    let shown = CGRect(origin: .zero, size: natural).applying(preferred)
    let transform = preferred.concatenating(CGAffineTransform(translationX: -shown.minX, y: -shown.minY))
    return (CGSize(width: abs(shown.width), height: abs(shown.height)), transform)
  }

  /// Crop + scale + frame rate as one transform on the video track.
  private static func composition(
    for asset: AVAsset,
    track: AVAssetTrack,
    shape: Shape,
    duration: CMTime
  ) -> AVMutableVideoComposition {
    let (display, toUpright) = Self.upright(track)

    let crop = CGRect(
      x: CGFloat(shape.cropX) * display.width,
      y: CGFloat(shape.cropY) * display.height,
      width: max(2, CGFloat(shape.cropW) * display.width),
      height: max(2, CGFloat(shape.cropH) * display.height)
    )
    let shortSide = min(crop.width, crop.height)
    var scale: CGFloat = 1
    if shape.maxShortSide > 0 && shortSide > CGFloat(shape.maxShortSide) {
      scale = CGFloat(shape.maxShortSide) / shortSide
    }
    let renderSize = CGSize(width: even(crop.width * scale), height: even(crop.height * scale))
    let transform = toUpright
      .concatenating(CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))

    let composition = AVMutableVideoComposition(propertiesOf: asset)
    composition.renderSize = renderSize
    let fps = targetFps(track: track, asked: shape.fps)
    composition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, fps.rounded())))

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(transform, at: .zero)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]
    return composition
  }

  /// The sound track that plays by default (the first enabled one).
  private static func mainAudioTrack(_ asset: AVAsset) -> AVAssetTrack? {
    let tracks = asset.tracks(withMediaType: .audio)
    return tracks.first(where: { $0.isEnabled }) ?? tracks.first
  }

  private static func even(_ value: CGFloat) -> CGFloat {
    max(2, (value / 2).rounded() * 2)
  }

  /// Runs an export with progress events, a short background grace period and cleanup.
  /// When it fails and there is a backup plan, the backup encoder takes over.
  private func run(
    _ session: AVAssetExportSession,
    asset: AVAsset,
    outURL: URL,
    jobId: String,
    promise: Promise,
    backup: BackupPlan?
  ) {
    try? FileManager.default.removeItem(at: outURL)
    session.outputURL = outURL
    session.outputFileType = outURL.pathExtension.lowercased() == "mov" ? .mov : .mp4
    session.shouldOptimizeForNetworkUse = true
    session.metadata = asset.metadata

    DispatchQueue.main.async {
      self.sessions[jobId] = session
      // Keeps the export going for a little while if the app is sent to the background.
      var backgroundTask = UIBackgroundTaskIdentifier.invalid
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "ReelVaultCompress") {
        session.cancelExport()
      }

      let timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
        self.sendEvent("onProgress", ["jobId": jobId, "progress": Double(session.progress)])
      }

      session.exportAsynchronously {
        DispatchQueue.main.async {
          timer.invalidate()
          self.sessions[jobId] = nil
          if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
          }
          switch session.status {
          case .completed:
            let attributes = try? FileManager.default.attributesOfItem(atPath: outURL.path)
            let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
            promise.resolve(["size": size])
          case .cancelled:
            try? FileManager.default.removeItem(at: outURL)
            promise.reject("ERR_CANCELLED", "Stopped.")
          default:
            try? FileManager.default.removeItem(at: outURL)
            if let backup = backup {
              NSLog("[ReelVaultCompress] exporter failed (\(Self.describe(session.error))), using the backup encoder")
              self.runBackup(backup, outURL: outURL, jobId: jobId, promise: promise, firstError: session.error)
            } else {
              promise.reject("ERR_EXPORT", Self.describe(session.error))
            }
          }
        }
      }
    }
  }

  /// The backup encoder on a background queue, with progress, cancel and cleanup.
  private func runBackup(_ plan: BackupPlan, outURL: URL, jobId: String, promise: Promise, firstError: Error?) {
    let job = BackupJob()
    DispatchQueue.main.async {
      self.backups[jobId] = job
      self.sendEvent("onProgress", ["jobId": jobId, "progress": 0.0])
      var backgroundTask = UIBackgroundTaskIdentifier.invalid
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "ReelVaultCompressBackup") {
        job.cancel()
      }

      DispatchQueue.global(qos: .userInitiated).async {
        var lastSent = Date.distantPast
        let result: Result<Int64, Error>
        do {
          let size = try Self.encode(plan, outURL: outURL, job: job) { progress in
            let now = Date()
            guard now.timeIntervalSince(lastSent) >= 0.5 else { return }
            lastSent = now
            DispatchQueue.main.async {
              self.sendEvent("onProgress", ["jobId": jobId, "progress": progress])
            }
          }
          result = .success(size)
        } catch {
          result = .failure(error)
        }

        DispatchQueue.main.async {
          self.backups[jobId] = nil
          if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
          }
          switch result {
          case .success(let size):
            promise.resolve(["size": size])
          case .failure(let error):
            try? FileManager.default.removeItem(at: outURL)
            if job.cancelled {
              promise.reject("ERR_CANCELLED", "Stopped.")
            } else {
              let first = firstError.map { " First try: \(Self.describe($0))." } ?? ""
              promise.reject("ERR_EXPORT", "\(Self.describe(error)).\(first)")
            }
          }
        }
      }
    }
  }

  /// Reads the frames, keeps at most `fps` of them per second, and writes HEVC
  /// (H.264 if this iPhone can't) plus AAC sound. Blocks until done; returns the size.
  private static func encode(
    _ plan: BackupPlan,
    outURL: URL,
    job: BackupJob,
    progress: @escaping (Double) -> Void
  ) throws -> Int64 {
    let fileType: AVFileType = outURL.pathExtension.lowercased() == "mov" ? .mov : .mp4
    let track = plan.track
    let shape = plan.shape
    let fps = targetFps(track: track, asked: shape.fps)
    let minGap = CMTime(seconds: 1 / fps * 0.9, preferredTimescale: 600_000)

    // Sound is kept when it can be read; a file whose sound can't be decoded still gets its picture.
    var made = try makeReader(plan, withAudio: true)
    if !made.reader.startReading() {
      if made.audio == nil { throw made.reader.error ?? CompressError(message: "The video could not be read") }
      made = try makeReader(plan, withAudio: false)
      guard made.reader.startReading() else {
        throw made.reader.error ?? CompressError(message: "The video could not be read")
      }
    }
    let reader = made.reader
    let videoOut = made.video
    let audioOut = made.audio

    // Output size: the composition's when cropping, otherwise the stored frame scaled down.
    let width: Int
    let height: Int
    var writerTransform = CGAffineTransform.identity
    if let composed = videoOut as? AVAssetReaderVideoCompositionOutput, let size = composed.videoComposition?.renderSize {
      width = Int(size.width)
      height = Int(size.height)
    } else {
      let natural = track.naturalSize
      let shortSide = min(abs(natural.width), abs(natural.height))
      var scale: CGFloat = 1
      if shape.maxShortSide > 0 && shortSide > CGFloat(shape.maxShortSide) {
        scale = CGFloat(shape.maxShortSide) / shortSide
      }
      width = Int(even(abs(natural.width) * scale))
      height = Int(even(abs(natural.height) * scale))
      writerTransform = track.preferredTransform
    }

    try? FileManager.default.removeItem(at: outURL)
    let writer = try AVAssetWriter(outputURL: outURL, fileType: fileType)
    writer.shouldOptimizeForNetworkUse = true
    // Only the plain items (date, place, camera) – odd ones could stop the writer.
    let keep: Set<AVMetadataKey> = [.commonKeyCreationDate, .commonKeyLocation, .commonKeyMake, .commonKeyModel, .commonKeySoftware]
    writer.metadata = plan.asset.metadata.filter { item in item.commonKey.map { keep.contains($0) } ?? false }

    // Bitrate: enough for a sharp picture, never more than the original used.
    let pixelsPerSecond = Double(width * height) * fps
    let sourceRate = Double(track.estimatedDataRate)
    var bitrate: Double
    if plan.bitrateShare > 0 && sourceRate > 0 {
      // A chosen strength: a share of what the source used, less again for fewer pixels or frames.
      let natural = track.naturalSize
      let sourcePixels = Double(abs(natural.width * natural.height))
      let pixelShare = sourcePixels > 0 ? min(1, Double(width * height) / sourcePixels) : 1
      let sourceFps = Double(track.nominalFrameRate)
      let frameShare = sourceFps > 0 && sourceFps <= 240 ? min(1, fps / sourceFps) : 1
      bitrate = max(200_000, sourceRate * plan.bitrateShare * pow(pixelShare, 0.7) * pow(frameShare, 0.5))
    } else {
      bitrate = max(1_000_000, pixelsPerSecond * 0.06)
      if sourceRate > 0 { bitrate = min(bitrate, sourceRate * 0.8) }
      bitrate = max(500_000, bitrate)
    }

    // Sound: 160 kbit/s, or with a chosen strength at most 128 kbit/s and never more than the source had.
    var audioRate = 160_000
    if plan.bitrateShare > 0 {
      let sourceAudio = Double(Self.mainAudioTrack(plan.asset)?.estimatedDataRate ?? 0)
      audioRate = sourceAudio > 0 ? Int(min(128_000, max(64_000, sourceAudio))) : 128_000
    }

    func videoSettings(_ codec: AVVideoCodecType, _ rate: Double) -> [String: Any] {
      [
        AVVideoCodecKey: codec,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: Int(rate),
          AVVideoExpectedSourceFrameRateKey: Int(fps.rounded()),
          AVVideoMaxKeyFrameIntervalKey: max(1, Int((fps * 2).rounded())),
        ],
      ]
    }
    var settings = videoSettings(.hevc, bitrate)
    if !writer.canApply(outputSettings: settings, forMediaType: .video) {
      settings = videoSettings(.h264, bitrate * 1.4)
    }
    guard writer.canApply(outputSettings: settings, forMediaType: .video) else {
      reader.cancelReading()
      throw CompressError(message: "This iPhone can't encode a \(width)×\(height) video")
    }
    let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    videoIn.expectsMediaDataInRealTime = false
    videoIn.transform = writerTransform
    guard writer.canAdd(videoIn) else {
      reader.cancelReading()
      throw CompressError(message: "The new video could not be set up")
    }
    writer.add(videoIn)

    var audioIn: AVAssetWriterInput?
    if audioOut != nil {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVNumberOfChannelsKey: 2,
        AVSampleRateKey: 44_100,
        AVEncoderBitRateKey: audioRate,
      ])
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        audioIn = input
      }
    }

    guard writer.startWriting() else {
      reader.cancelReading()
      throw writer.error ?? CompressError(message: "The new video could not be started")
    }
    writer.startSession(atSourceTime: plan.timeRange.start)

    let start = plan.timeRange.start.seconds
    let length = max(0.001, plan.timeRange.duration.seconds)
    let group = DispatchGroup()

    // Video: frames in order, extra frames (closer than one frame at `fps`) dropped.
    group.enter()
    let video = PumpState()
    videoIn.requestMediaDataWhenReady(on: DispatchQueue(label: "ReelVaultCompress.video")) {
      while !video.done && videoIn.isReadyForMoreMediaData {
        guard !job.cancelled, let buffer = videoOut.copyNextSampleBuffer() else {
          videoIn.markAsFinished()
          video.done = true
          group.leave()
          return
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(buffer)
        guard pts.isValid, CMSampleBufferGetImageBuffer(buffer) != nil || CMSampleBufferGetNumSamples(buffer) > 0 else {
          continue
        }
        if video.lastKept.isValid && CMTimeCompare(CMTimeSubtract(pts, video.lastKept), minGap) < 0 { continue }
        video.lastKept = pts
        if !videoIn.append(buffer) {
          videoIn.markAsFinished()
          video.done = true
          group.leave()
          return
        }
        progress(min(1, max(0, (pts.seconds - start) / length)))
      }
    }

    if let audioIn = audioIn, let audioOut = audioOut {
      group.enter()
      let audio = PumpState()
      audioIn.requestMediaDataWhenReady(on: DispatchQueue(label: "ReelVaultCompress.audio")) {
        while !audio.done && audioIn.isReadyForMoreMediaData {
          guard !job.cancelled, let buffer = audioOut.copyNextSampleBuffer(), audioIn.append(buffer) else {
            audioIn.markAsFinished()
            audio.done = true
            group.leave()
            return
          }
        }
      }
    }

    group.wait()

    if job.cancelled {
      reader.cancelReading()
      writer.cancelWriting()
      throw CompressError(message: "Stopped")
    }
    if reader.status == .failed {
      writer.cancelWriting()
      throw reader.error ?? CompressError(message: "The video could not be read to the end")
    }
    if writer.status == .failed {
      reader.cancelReading()
      throw writer.error ?? CompressError(message: "The new video could not be written")
    }

    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    finished.wait()
    guard writer.status == .completed else {
      throw writer.error ?? CompressError(message: "The new video could not be finished")
    }

    let attributes = try? FileManager.default.attributesOfItem(atPath: outURL.path)
    return (attributes?[.size] as? NSNumber)?.int64Value ?? 0
  }

  /// A reader over the trimmed range: decoded frames (through a composition when
  /// cropping) and, if asked, the sound mixed to 44.1 kHz stereo.
  private static func makeReader(
    _ plan: BackupPlan,
    withAudio: Bool
  ) throws -> (reader: AVAssetReader, video: AVAssetReaderOutput, audio: AVAssetReaderOutput?) {
    let reader = try AVAssetReader(asset: plan.asset)
    reader.timeRange = plan.timeRange

    let pixels: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ]
    let videoOut: AVAssetReaderOutput
    if plan.shape.fullFrame {
      videoOut = AVAssetReaderTrackOutput(track: plan.track, outputSettings: pixels)
    } else {
      let composed = AVAssetReaderVideoCompositionOutput(videoTracks: [plan.track], videoSettings: pixels)
      composed.videoComposition = composition(for: plan.asset, track: plan.track, shape: plan.shape, duration: plan.asset.duration)
      videoOut = composed
    }
    videoOut.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOut) else { throw CompressError(message: "The video picture could not be read") }
    reader.add(videoOut)

    var audioOut: AVAssetReaderOutput?
    // Only the main sound track: mixing every track would play two languages at once.
    if withAudio, let audioTrack = mainAudioTrack(plan.asset) {
      let mix = AVAssetReaderAudioMixOutput(audioTracks: [audioTrack], audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 2,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ])
      mix.alwaysCopiesSampleData = false
      if reader.canAdd(mix) {
        reader.add(mix)
        audioOut = mix
      }
    }
    return (reader: reader, video: videoOut, audio: audioOut)
  }

  /// The error's own words plus Apple's codes, so a failure report says what went wrong.
  private static func describe(_ error: Error?) -> String {
    guard let error = error else { return "The video could not be re-encoded" }
    let ns = error as NSError
    var text = ns.localizedDescription
    if let reason = ns.localizedFailureReason, !reason.isEmpty, reason != text { text += " – \(reason)" }
    var codes = "\(ns.domain) \(ns.code)"
    if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
      codes += ", \(underlying.domain) \(underlying.code)"
    }
    return "\(text) [\(codes)]"
  }

  private static func shortSide(for quality: String) -> Double {
    switch quality {
    case "1080p": return 1080
    case "720p": return 720
    case "small": return 480
    default: return 0
    }
  }

  private static func presetName(_ quality: String) -> String {
    switch quality {
    case "1080p": return AVAssetExportPresetHEVC1920x1080
    case "720p": return AVAssetExportPreset1280x720
    case "small": return AVAssetExportPresetMediumQuality
    default: return AVAssetExportPresetHEVCHighestQuality
    }
  }
}
