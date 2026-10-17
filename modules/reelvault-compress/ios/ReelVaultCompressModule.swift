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
}

/// "Make Smaller" and the video editor: re-encodes with Apple's exporter (the
/// same hardware HEVC encoder the Camera app uses). Trims, crops, scales and
/// lowers the frame rate through a video composition; the file's date and
/// location metadata are carried over.
public class ReelVaultCompressModule: Module {
  /// Running exports by job id. Only touched on the main queue.
  private var sessions: [String: AVAssetExportSession] = [:]

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
      guard let session = AVAssetExportSession(asset: asset, presetName: Self.presetName(quality)) else {
        promise.reject("ERR_PRESET", "This video can't be made smaller with that setting.")
        return
      }
      self.run(session, asset: asset, outURL: outURL, jobId: jobId, promise: promise)
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

      let fullFrame = options.cropX <= 0 && options.cropY <= 0 && options.cropW >= 1 && options.cropH >= 1
      let needsComposition = !fullFrame || options.maxShortSide > 0 || options.fps > 0
      let preset = options.passthrough && !needsComposition
        ? AVAssetExportPresetPassthrough
        : AVAssetExportPresetHEVCHighestQuality
      guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
        promise.reject("ERR_PRESET", "This video can't be edited on this iPhone.")
        return
      }
      session.timeRange = CMTimeRange(start: start, end: end)

      if needsComposition {
        guard let track = asset.tracks(withMediaType: .video).first else {
          promise.reject("ERR_TRACK", "This file has no video picture.")
          return
        }
        session.videoComposition = Self.composition(for: asset, track: track, options: options, duration: duration)
      }
      self.run(session, asset: asset, outURL: outURL, jobId: jobId, promise: promise)
    }

    Function("cancel") { (jobId: String) in
      DispatchQueue.main.async {
        self.sessions[jobId]?.cancelExport()
      }
    }
  }

  /// Crop + scale + frame rate as one transform on the video track.
  private static func composition(
    for asset: AVAsset,
    track: AVAssetTrack,
    options: EditOptions,
    duration: CMTime
  ) -> AVMutableVideoComposition {
    let natural = track.naturalSize
    let preferred = track.preferredTransform
    // The frame as it is shown (rotation applied), moved to start at 0,0.
    let shown = CGRect(origin: .zero, size: natural).applying(preferred)
    let displayW = abs(shown.width)
    let displayH = abs(shown.height)
    let upright = preferred.concatenating(CGAffineTransform(translationX: -shown.minX, y: -shown.minY))

    let crop = CGRect(
      x: CGFloat(options.cropX) * displayW,
      y: CGFloat(options.cropY) * displayH,
      width: max(2, CGFloat(options.cropW) * displayW),
      height: max(2, CGFloat(options.cropH) * displayH)
    )
    let shortSide = min(crop.width, crop.height)
    var scale: CGFloat = 1
    if options.maxShortSide > 0 && shortSide > CGFloat(options.maxShortSide) {
      scale = CGFloat(options.maxShortSide) / shortSide
    }
    let renderSize = CGSize(width: even(crop.width * scale), height: even(crop.height * scale))
    let transform = upright
      .concatenating(CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))

    let composition = AVMutableVideoComposition(propertiesOf: asset)
    composition.renderSize = renderSize
    let sourceFps = track.nominalFrameRate > 0 ? Double(track.nominalFrameRate) : 30
    let fps = options.fps > 0 ? min(options.fps, sourceFps) : sourceFps
    composition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, fps.rounded())))

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(transform, at: .zero)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]
    return composition
  }

  private static func even(_ value: CGFloat) -> CGFloat {
    max(2, (value / 2).rounded() * 2)
  }

  /// Runs an export with progress events, a short background grace period and cleanup.
  private func run(_ session: AVAssetExportSession, asset: AVAsset, outURL: URL, jobId: String, promise: Promise) {
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
            promise.reject("ERR_EXPORT", session.error?.localizedDescription ?? "The video could not be re-encoded.")
          }
        }
      }
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
