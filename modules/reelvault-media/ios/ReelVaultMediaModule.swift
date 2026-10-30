import AudioToolbox
import AVFoundation
import ExpoModulesCore
import MediaPlayer
import PDFKit
import UIKit
import Vision

struct MediaError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// Storage housekeeping for ReelVault: video frames written straight to a
/// small JPEG (instead of a full-resolution still plus a copy in the cache),
/// shrinking existing pictures, measuring folders, and clearing old temporary
/// files. Everything runs off the main thread.
public class ReelVaultMediaModule: Module {
  private let work = DispatchQueue(label: "reelvault.media", qos: .utility)
  // Volume buttons as page keys (manga reader). Only touched on the main queue.
  private var volumeObservation: NSKeyValueObservation?
  private var volumeView: MPVolumeView?
  private var restoreVolume: Float = 0.5
  private var centerVolume: Float = 0.5
  private var savedAudio: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

  public func definition() -> ModuleDefinition {
    Name("ReelVaultMedia")

    Events("onBoostProgress", "onVolumeKey")

    /// Picture fingerprints of a video (a 64-bit "difference hash" as 16 hex
    /// characters) at the given fractions of its length; "" where a frame
    /// could not be read. Two copies of one clip have nearly the same ones,
    /// even re-encoded, resized or trimmed.
    AsyncFunction("videoPrints") { (input: String, fractions: [Double], promise: Promise) in
      guard let inURL = Self.url(input) else {
        promise.resolve([String]())
        return
      }
      DispatchQueue.global(qos: .utility).async {
        let asset = AVURLAsset(url: inURL)
        let length = asset.duration.seconds
        guard length.isFinite, length > 0 else {
          promise.resolve([String]())
          return
        }
        let g = Self.frameGenerator(asset, side: 96)
        let out: [String] = fractions.map { f in
          let t = CMTime(seconds: max(0, min(length - 0.05, length * f)), preferredTimescale: 600)
          guard let image = try? g.copyCGImage(at: t, actualTime: nil) else { return "" }
          return Self.differenceHash(image) ?? ""
        }
        promise.resolve(out)
      }
    }

    /// What the phone sees in a video, a frame every `everySec` seconds (at
    /// most `maxFrames`, spread over the whole video): scene words ("dog",
    /// "beach", "car") and text on screen. All on the phone.
    AsyncFunction("scanFrames") { (input: String, everySec: Double, maxFrames: Int, promise: Promise) in
      guard let inURL = Self.url(input) else {
        promise.resolve([[String: Any]]())
        return
      }
      DispatchQueue.global(qos: .utility).async {
        let asset = AVURLAsset(url: inURL)
        let length = asset.duration.seconds
        guard length.isFinite, length > 0 else {
          promise.resolve([[String: Any]]())
          return
        }
        let step = max(1, everySec)
        var times = Array(stride(from: min(1, length / 2), to: length, by: step))
        let cap = max(1, maxFrames)
        if times.count > cap {
          times = (0..<cap).map { length * (Double($0) + 0.5) / Double(cap) }
        }
        let g = Self.frameGenerator(asset, side: 640)
        var out: [[String: Any]] = []
        for t in times {
          autoreleasepool {
            guard let image = try? g.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { return }
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            let classify = VNClassifyImageRequest()
            let text = VNRecognizeTextRequest()
            text.recognitionLevel = .fast
            text.usesLanguageCorrection = false
            try? handler.perform([classify, text])
            let labels = (classify.results ?? [])
              .filter { $0.confidence >= 0.3 }
              .prefix(8)
              .map { $0.identifier.replacingOccurrences(of: "_", with: " ") }
            let words = (text.results ?? [])
              .compactMap { $0.topCandidates(1).first?.string }
              .joined(separator: " ")
            if labels.isEmpty && words.isEmpty { return }
            out.append(["atMs": t * 1000, "labels": Array(labels), "text": String(words.prefix(300))])
          }
        }
        promise.resolve(out)
      }
    }

    /// The volume buttons send "onVolumeKey" ({direction: "up" | "down"}) instead
    /// of changing the volume (no volume pop-up), until stopVolumeKeys.
    Function("startVolumeKeys") {
      DispatchQueue.main.async { self.startVolumeKeys() }
    }

    Function("stopVolumeKeys") {
      DispatchQueue.main.async { self.stopVolumeKeys() }
    }

    OnDestroy {
      DispatchQueue.main.async { self.stopVolumeKeys() }
    }

    /// Voice Boost: a copy of an audio file with clearer, evener, louder speech
    /// (rumble cut, voice frequencies lifted, quiet and loud parts brought
    /// together, peaks held below clipping). Same length, so positions,
    /// chapters and read-along stay right. Resolves with the new file's size.
    AsyncFunction("voiceBoost") { (input: String, output: String, jobId: String, promise: Promise) in
      guard let inURL = Self.url(input), let outURL = Self.url(output) else {
        promise.reject("ERR_URL", "That file address could not be read.")
        return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        var lastSent = Date.distantPast
        do {
          try Self.boost(inURL, outURL) { p in
            let now = Date()
            guard now.timeIntervalSince(lastSent) >= 0.5 else { return }
            lastSent = now
            DispatchQueue.main.async { self.sendEvent("onBoostProgress", ["jobId": jobId, "progress": p]) }
          }
          let size = (try? FileManager.default.attributesOfItem(atPath: outURL.path))?[.size] as? NSNumber
          promise.resolve(size?.doubleValue ?? 0)
        } catch {
          try? FileManager.default.removeItem(at: outURL)
          promise.reject("ERR_BOOST", error.localizedDescription)
        }
      }
    }

    /// The sound of a video (or part of it) as an .m4a file; its size and length.
    AsyncFunction("exportAudio") { (input: String, output: String, startMs: Double, endMs: Double, promise: Promise) in
      guard let inURL = Self.url(input), let outURL = Self.url(output) else {
        promise.reject("ERR_URL", "That file address could not be read.")
        return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let asset = AVURLAsset(url: inURL)
          guard !asset.tracks(withMediaType: .audio).isEmpty else { throw MediaError(message: "This video has no sound.") }
          let total = asset.duration.seconds
          let start = max(0, startMs / 1000)
          let end = endMs > 0 && total.isFinite ? min(endMs / 1000, total) : total
          guard end.isFinite, end > start else { throw MediaError(message: "That part is empty.") }
          try Self.exportAudioSync(asset, to: outURL, start: start, length: end - start)
          let size = (try? FileManager.default.attributesOfItem(atPath: outURL.path))?[.size] as? NSNumber
          promise.resolve(["size": size?.doubleValue ?? 0, "durationMs": (end - start) * 1000])
        } catch {
          try? FileManager.default.removeItem(at: outURL)
          promise.reject("ERR_AUDIO", error.localizedDescription)
        }
      }
    }

    /// Chapter markers stored in an MP4 or MOV file: title, start and end in ms.
    AsyncFunction("chapters") { (input: String, promise: Promise) in
      guard let inURL = Self.url(input) else {
        promise.resolve([])
        return
      }
      self.work.async {
        let asset = AVURLAsset(url: inURL)
        let groups = asset.chapterMetadataGroups(bestMatchingPreferredLanguages: Locale.preferredLanguages)
        var out: [[String: Any]] = []
        for (i, g) in groups.enumerated() {
          let start = g.timeRange.start.seconds
          let end = CMTimeRangeGetEnd(g.timeRange).seconds
          guard start.isFinite else { continue }
          let title = AVMetadataItem.metadataItems(from: g.items, filteredByIdentifier: .commonIdentifierTitle).first?.stringValue
          out.append(["title": title ?? "Chapter \(i + 1)", "startMs": start * 1000, "endMs": end.isFinite ? end * 1000 : 0])
        }
        promise.resolve(out)
      }
    }

    /// One frame of a video as a JPEG no larger than `maxSide` pixels on its long side.
    AsyncFunction("frame") { (input: String, timeMs: Double, output: String, maxSide: Double, quality: Double, promise: Promise) in
      guard let inURL = Self.url(input), let outURL = Self.url(output) else {
        promise.reject("ERR_URL", "That file address could not be read.")
        return
      }
      self.work.async {
        let asset = AVURLAsset(url: inURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        if maxSide > 0 { generator.maximumSize = CGSize(width: maxSide, height: maxSide) }
        let tolerance = CMTime(seconds: 0.4, preferredTimescale: 600)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        let time = CMTime(seconds: max(0, timeMs / 1000), preferredTimescale: 600)
        do {
          let cg = try generator.copyCGImage(at: time, actualTime: nil)
          guard let data = UIImage(cgImage: cg).jpegData(compressionQuality: CGFloat(max(0.1, min(1, quality)))) else {
            promise.reject("ERR_JPEG", "The frame could not be saved.")
            return
          }
          try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
          try? FileManager.default.removeItem(at: outURL)
          try data.write(to: outURL, options: .atomic)
          var videoWidth = 0
          var videoHeight = 0
          if let track = asset.tracks(withMediaType: .video).first {
            let size = track.naturalSize.applying(track.preferredTransform)
            videoWidth = Int(abs(size.width))
            videoHeight = Int(abs(size.height))
          }
          promise.resolve([
            "width": cg.width,
            "height": cg.height,
            "videoWidth": videoWidth,
            "videoHeight": videoHeight,
            "size": data.count,
          ])
        } catch {
          promise.reject("ERR_FRAME", error.localizedDescription)
        }
      }
    }

    /// Re-saves a picture at most `maxSide` pixels on its long side. Returns its size afterwards
    /// (unchanged when that would not make it smaller), or -1 when it is not a picture.
    AsyncFunction("shrinkImage") { (path: String, maxSide: Double, quality: Double, promise: Promise) in
      guard let url = Self.url(path) else {
        promise.resolve(-1)
        return
      }
      self.work.async {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let before = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        guard let image = UIImage(contentsOfFile: url.path) else {
          promise.resolve(-1)
          return
        }
        let w = image.size.width * image.scale
        let h = image.size.height * image.scale
        let scale = min(1, maxSide / max(1, max(w, h)))
        let size = CGSize(width: max(1, floor(w * scale)), height: max(1, floor(h * scale)))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
          image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = resized.jpegData(compressionQuality: CGFloat(max(0.1, min(1, quality)))), data.count < before else {
          promise.resolve(before)
          return
        }
        do {
          try data.write(to: url, options: .atomic)
          promise.resolve(data.count)
        } catch {
          promise.resolve(before)
        }
      }
    }

    /// Every page of a PDF as a JPEG (0001.jpg, 0002.jpg...) in `outDir`, at most `maxSide`
    /// pixels on the long side, one page at a time so memory stays flat. Returns the page count.
    AsyncFunction("pdfPages") { (input: String, outDir: String, maxSide: Double, quality: Double, promise: Promise) in
      guard let inURL = Self.url(input), let outURL = Self.url(outDir) else {
        promise.reject("ERR_URL", "That file address could not be read.")
        return
      }
      self.work.async {
        guard let doc = PDFDocument(url: inURL) else {
          promise.reject("ERR_PDF", "This PDF could not be opened (it may be locked with a password).")
          return
        }
        do {
          try FileManager.default.createDirectory(at: outURL, withIntermediateDirectories: true)
          var written = 0
          for i in 0..<doc.pageCount {
            try autoreleasepool {
              guard let page = doc.page(at: i) else { return }
              let box = page.bounds(for: .mediaBox)
              let longSide = max(box.width, box.height)
              guard longSide > 0 else { return }
              let scale = CGFloat(maxSide) / longSide
              let size = CGSize(width: max(1, floor(box.width * scale)), height: max(1, floor(box.height * scale)))
              let image = page.thumbnail(of: size, for: .mediaBox)
              guard let data = image.jpegData(compressionQuality: CGFloat(max(0.1, min(1, quality)))) else { return }
              let name = String(format: "%04d.jpg", i + 1)
              try data.write(to: outURL.appendingPathComponent(name), options: .atomic)
              written += 1
            }
          }
          promise.resolve(written)
        } catch {
          promise.reject("ERR_PDF", error.localizedDescription)
        }
      }
    }

    /// A picture's main colours as "#rrggbb": the most vivid one (pixels grouped by hue, each
    /// counted by how colourful it is) and the plain average. Empty strings when it can't be read.
    AsyncFunction("colors") { (path: String, promise: Promise) in
      guard let url = Self.url(path) else {
        promise.resolve(["dominant": "", "average": ""])
        return
      }
      self.work.async {
        guard let image = UIImage(contentsOfFile: url.path), let cg = image.cgImage else {
          promise.resolve(["dominant": "", "average": ""])
          return
        }
        let side = 24
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let space = CGColorSpaceCreateDeviceRGB()
        let drawn: Bool = pixels.withUnsafeMutableBytes { raw -> Bool in
          guard let ctx = CGContext(
            data: raw.baseAddress,
            width: side,
            height: side,
            bitsPerComponent: 8,
            bytesPerRow: side * 4,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else { return false }
          ctx.interpolationQuality = .medium
          ctx.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
          return true
        }
        if !drawn {
          promise.resolve(["dominant": "", "average": ""])
          return
        }
        var sumR = 0.0
        var sumG = 0.0
        var sumB = 0.0
        var buckets = [[Double]](repeating: [0, 0, 0, 0], count: 12)
        for i in 0..<(side * side) {
          let r = Double(pixels[i * 4]) / 255
          let g = Double(pixels[i * 4 + 1]) / 255
          let b = Double(pixels[i * 4 + 2]) / 255
          sumR += r
          sumG += g
          sumB += b
          let hi = max(r, max(g, b))
          let lo = min(r, min(g, b))
          let delta = hi - lo
          if hi < 0.15 || delta < 0.12 { continue }
          var hue = 0.0
          if hi == r {
            hue = (g - b) / delta
          } else if hi == g {
            hue = 2 + (b - r) / delta
          } else {
            hue = 4 + (r - g) / delta
          }
          hue *= 60
          if hue < 0 { hue += 360 }
          let weight = delta
          let k = min(11, Int(hue / 30))
          buckets[k][0] += r * weight
          buckets[k][1] += g * weight
          buckets[k][2] += b * weight
          buckets[k][3] += weight
        }
        func hex(_ r: Double, _ g: Double, _ b: Double) -> String {
          let c = { (v: Double) -> Int in Int((max(0, min(1, v)) * 255).rounded()) }
          return String(format: "#%02x%02x%02x", c(r), c(g), c(b))
        }
        let n = Double(side * side)
        let average = hex(sumR / n, sumG / n, sumB / n)
        var best = -1
        var bestWeight = 0.0
        for k in 0..<12 {
          if buckets[k][3] > bestWeight {
            best = k
            bestWeight = buckets[k][3]
          }
        }
        var dominant = average
        if best >= 0 && bestWeight > 0.5 {
          dominant = hex(buckets[best][0] / bestWeight, buckets[best][1] / bestWeight, buckets[best][2] / bestWeight)
        }
        promise.resolve(["dominant": dominant, "average": average])
      }
    }

    /// A manga page's plain margins (white or black borders around the drawing), as fractions of
    /// its width and height, and the colour of its outer edge as "#rrggbb", for "Crop borders" and
    /// a background that matches the page. All zeros and "" when it can't be read.
    AsyncFunction("pageMargins") { (path: String, promise: Promise) in
      let none: [String: Any] = ["top": 0, "left": 0, "bottom": 0, "right": 0, "edge": ""]
      guard let url = Self.url(path) else {
        promise.resolve(none)
        return
      }
      self.work.async {
        guard let image = UIImage(contentsOfFile: url.path), let cg = image.cgImage, cg.width > 0, cg.height > 0 else {
          promise.resolve(none)
          return
        }
        let w = 160
        let h = max(16, min(480, Int((Double(cg.height) / Double(cg.width) * Double(w)).rounded())))
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let drawn: Bool = px.withUnsafeMutableBytes { raw -> Bool in
          guard let ctx = CGContext(
            data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
          ) else { return false }
          ctx.interpolationQuality = .medium
          ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
          return true
        }
        if !drawn {
          promise.resolve(none)
          return
        }
        // Row 0 of the buffer is the top of the picture.
        func at(_ x: Int, _ y: Int) -> (Int, Int, Int) {
          let i = (y * w + x) * 4
          return (Int(px[i]), Int(px[i + 1]), Int(px[i + 2]))
        }
        // The edge colour: the average of the outermost ring.
        var sr = 0, sg = 0, sb = 0, n = 0
        for x in 0..<w {
          for y in [0, h - 1] {
            let c = at(x, y)
            sr += c.0; sg += c.1; sb += c.2; n += 1
          }
        }
        for y in 0..<h {
          for x in [0, w - 1] {
            let c = at(x, y)
            sr += c.0; sg += c.1; sb += c.2; n += 1
          }
        }
        let edge = (sr / n, sg / n, sb / n)
        func plain(_ c: (Int, Int, Int)) -> Bool {
          abs(c.0 - edge.0) + abs(c.1 - edge.1) + abs(c.2 - edge.2) < 54
        }
        // A row or column is margin when (nearly) every pixel in it is the edge colour.
        func rowPlain(_ y: Int) -> Bool {
          var off = 0
          for x in 0..<w where !plain(at(x, y)) { off += 1 }
          return off <= w / 80
        }
        func colPlain(_ x: Int) -> Bool {
          var off = 0
          for y in 0..<h where !plain(at(x, y)) { off += 1 }
          return off <= h / 80
        }
        var top = 0
        while top < h / 3 && rowPlain(top) { top += 1 }
        var bottom = 0
        while bottom < h / 3 && rowPlain(h - 1 - bottom) { bottom += 1 }
        var left = 0
        while left < w / 3 && colPlain(left) { left += 1 }
        var right = 0
        while right < w / 3 && colPlain(w - 1 - right) { right += 1 }
        // A page that is almost all margin (a blank page) is left alone.
        if top + bottom > h * 6 / 10 || left + right > w * 6 / 10 {
          top = 0; bottom = 0; left = 0; right = 0
        }
        // Keep a hair of margin so lines at the very edge aren't cut.
        let fy = { (v: Int) -> Double in v > 1 ? Double(v - 1) / Double(h) : 0 }
        let fx = { (v: Int) -> Double in v > 1 ? Double(v - 1) / Double(w) : 0 }
        let hex = String(format: "#%02x%02x%02x", edge.0, edge.1, edge.2)
        promise.resolve(["top": fy(top), "left": fx(left), "bottom": fy(bottom), "right": fx(right), "edge": hex])
      }
    }

    /// Bytes a folder takes on disk, everything inside it counted.
    AsyncFunction("dirSize") { (path: String, promise: Promise) in
      guard let url = Self.url(path) else {
        promise.resolve(0)
        return
      }
      self.work.async {
        promise.resolve(Double(Self.size(of: url)))
      }
    }

    /// What sits directly in a folder: name, last change (ms since 1970), bytes on disk, and whether it is a folder.
    AsyncFunction("entries") { (path: String, promise: Promise) in
      guard let url = Self.url(path) else {
        promise.resolve([])
        return
      }
      self.work.async {
        let items = (try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey], options: [])) ?? []
        let out: [[String: Any]] = items.map { item in
          let v = try? item.resourceValues(forKeys: [.contentModificationDateKey, .isDirectoryKey])
          return [
            "name": item.lastPathComponent,
            "modified": (v?.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000,
            "bytes": Double(Self.size(of: item)),
            "dir": v?.isDirectory == true,
          ]
        }
        promise.resolve(out)
      }
    }

    /// Removes what sits directly in a folder and was last changed more than `olderThanSec`
    /// ago, except the names in `keep`. Returns the bytes freed.
    AsyncFunction("clearOld") { (path: String, olderThanSec: Double, keep: [String], promise: Promise) in
      guard let url = Self.url(path) else {
        promise.resolve(0)
        return
      }
      self.work.async {
        let fm = FileManager.default
        let cutoff = Date().addingTimeInterval(-olderThanSec)
        var freed: Int64 = 0
        let items = (try? fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey], options: [])) ?? []
        for item in items {
          if keep.contains(item.lastPathComponent) { continue }
          let date = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
          if date > cutoff { continue }
          let bytes = Self.size(of: item)
          if (try? fm.removeItem(at: item)) != nil { freed += bytes }
        }
        promise.resolve(Double(freed))
      }
    }
  }

  private static func frameGenerator(_ asset: AVAsset, side: CGFloat) -> AVAssetImageGenerator {
    let g = AVAssetImageGenerator(asset: asset)
    g.appliesPreferredTrackTransform = true
    g.maximumSize = CGSize(width: side, height: side)
    let tolerance = CMTime(seconds: 0.5, preferredTimescale: 600)
    g.requestedTimeToleranceBefore = tolerance
    g.requestedTimeToleranceAfter = tolerance
    return g
  }

  /// The picture shrunk to 9×8 grey pixels; each bit says whether a pixel is brighter than its right neighbour.
  private static func differenceHash(_ image: CGImage) -> String? {
    let w = 9
    let h = 8
    var px = [UInt8](repeating: 0, count: w * h)
    let drawn: Bool = px.withUnsafeMutableBytes { buf -> Bool in
      guard let ctx = CGContext(
        data: buf.baseAddress,
        width: w,
        height: h,
        bitsPerComponent: 8,
        bytesPerRow: w,
        space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGImageAlphaInfo.none.rawValue
      ) else { return false }
      ctx.interpolationQuality = .medium
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { return nil }
    var bits: UInt64 = 0
    for y in 0..<h {
      for x in 0..<(w - 1) {
        bits <<= 1
        if px[y * w + x] > px[y * w + x + 1] { bits |= 1 }
      }
    }
    return String(format: "%016llx", bits)
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  /// The system volume, through the hidden volume view's slider.
  private func setVolume(_ value: Float) {
    guard let slider = volumeView?.subviews.compactMap({ $0 as? UISlider }).first else { return }
    slider.value = value
    slider.sendActions(for: .valueChanged)
  }

  private func startVolumeKeys() {
    guard volumeObservation == nil else { return }
    let session = AVAudioSession.sharedInstance()
    // Volume changes are only reported while the session is active. Activating it
    // must not stop other apps' sound (music while reading): mix with them, and
    // put the app's own setting back afterwards. An audiobook of ours that is
    // playing keeps its setting untouched.
    savedAudio = (session.category, session.mode, session.categoryOptions)
    let ownPlayback = session.category == .playback && !session.isOtherAudioPlaying
    if !ownPlayback {
      let category: AVAudioSession.Category = session.category == .playback ? .playback : .ambient
      try? session.setCategory(category, mode: .default, options: session.categoryOptions.union(.mixWithOthers))
    }
    try? session.setActive(true)
    // A volume view on screen (invisible) keeps the system volume pop-up away.
    let view = MPVolumeView(frame: CGRect(x: -200, y: -200, width: 40, height: 40))
    view.alpha = 0.0001
    view.isUserInteractionEnabled = false
    Self.keyWindow()?.addSubview(view)
    volumeView = view
    restoreVolume = session.outputVolume
    // Away from the ends, so both buttons always register.
    centerVolume = min(0.85, max(0.15, restoreVolume))
    if abs(centerVolume - restoreVolume) > 0.001 {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.setVolume(self.centerVolume) }
    }
    volumeObservation = session.observe(\.outputVolume, options: [.old, .new]) { [weak self] _, change in
      guard let new = change.newValue, let old = change.oldValue, abs(new - old) > 0.0001 else { return }
      DispatchQueue.main.async {
        guard let self = self, self.volumeObservation != nil else { return }
        // Our own reset back to the middle.
        if abs(new - self.centerVolume) < 0.001 { return }
        self.sendEvent("onVolumeKey", ["direction": new > old ? "up" : "down"])
        self.setVolume(self.centerVolume)
      }
    }
  }

  private func stopVolumeKeys() {
    guard volumeObservation != nil else { return }
    volumeObservation?.invalidate()
    volumeObservation = nil
    setVolume(restoreVolume)
    if let saved = savedAudio {
      try? AVAudioSession.sharedInstance().setCategory(saved.0, mode: saved.1, options: saved.2)
    }
    savedAudio = nil
    let view = volumeView
    volumeView = nil
    // Leave the view a moment so putting the volume back shows no pop-up.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { view?.removeFromSuperview() }
  }

  /// Sets one parameter of an Apple audio effect.
  private static func setParam(_ unit: AVAudioUnitEffect, _ param: AudioUnitParameterID, _ value: AudioUnitParameterValue) {
    AudioUnitSetParameter(unit.audioUnit, param, kAudioUnitScope_Global, 0, value, 0)
  }

  private static func appleEffect(_ subType: OSType) -> AVAudioUnitEffect {
    AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
      componentType: kAudioUnitType_Effect,
      componentSubType: subType,
      componentManufacturer: kAudioUnitManufacturer_Apple,
      componentFlags: 0,
      componentFlagsMask: 0
    ))
  }

  /// Renders `inURL` through the Voice Boost chain into an AAC .m4a, faster than real time.
  private static func boost(_ inURL: URL, _ outURL: URL, progress: (Double) -> Void) throws {
    try? FileManager.default.removeItem(at: outURL)
    try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    let source = try AVAudioFile(forReading: inURL)
    let format = source.processingFormat
    let total = source.length
    guard total > 0 else { throw MediaError(message: "This file has no sound.") }

    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    let eq = AVAudioUnitEQ(numberOfBands: 3)
    // Rumble and handling noise out.
    eq.bands[0].filterType = .highPass
    eq.bands[0].frequency = 80
    eq.bands[0].bypass = false
    // A little less boom from close microphones.
    eq.bands[1].filterType = .lowShelf
    eq.bands[1].frequency = 200
    eq.bands[1].gain = -2
    eq.bands[1].bypass = false
    // Speech clarity.
    eq.bands[2].filterType = .parametric
    eq.bands[2].frequency = 3000
    eq.bands[2].bandwidth = 1.2
    eq.bands[2].gain = 4
    eq.bands[2].bypass = false

    let compressor = appleEffect(kAudioUnitSubType_DynamicsProcessor)
    let limiter = appleEffect(kAudioUnitSubType_PeakLimiter)

    engine.attach(player)
    engine.attach(eq)
    engine.attach(compressor)
    engine.attach(limiter)
    engine.connect(player, to: eq, format: format)
    engine.connect(eq, to: compressor, format: format)
    engine.connect(compressor, to: limiter, format: format)
    engine.connect(limiter, to: engine.mainMixerNode, format: format)

    try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)

    // Quiet and loud parts closer together, then louder overall with peaks held.
    setParam(compressor, kDynamicsProcessorParam_Threshold, -26)
    setParam(compressor, kDynamicsProcessorParam_HeadRoom, 8)
    setParam(compressor, kDynamicsProcessorParam_AttackTime, 0.004)
    setParam(compressor, kDynamicsProcessorParam_ReleaseTime, 0.2)
    setParam(limiter, kLimiterParam_PreGain, 9)
    setParam(limiter, kLimiterParam_AttackTime, 0.002)
    setParam(limiter, kLimiterParam_DecayTime, 0.05)

    try engine.start()
    player.scheduleFile(source, at: nil)
    player.play()
    defer {
      player.stop()
      engine.stop()
    }

    let channels = Int(format.channelCount)
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: channels,
      AVEncoderBitRateKey: channels > 1 ? 128_000 : 64_000,
    ]
    // The file is finished when it goes out of scope.
    do {
      let out = try AVAudioFile(forWriting: outURL, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
      guard let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: engine.manualRenderingMaximumFrameCount) else {
        throw MediaError(message: "Voice Boost could not start.")
      }
      var stalls = 0
      while engine.manualRenderingSampleTime < total {
        let left = total - engine.manualRenderingSampleTime
        let frames = AVAudioFrameCount(min(Int64(buffer.frameCapacity), left))
        let status = try engine.renderOffline(frames, to: buffer)
        switch status {
        case .success:
          try out.write(from: buffer)
          stalls = 0
        case .error:
          throw MediaError(message: "Voice Boost failed on this file.")
        default:
          stalls += 1
          if stalls > 1000 { throw MediaError(message: "Voice Boost stalled on this file.") }
        }
        progress(Double(engine.manualRenderingSampleTime) / Double(total))
      }
    }
    progress(1)
  }

  /// Writes part of an asset's sound as AAC in an .m4a file. Blocks until done.
  private static func exportAudioSync(_ asset: AVAsset, to outURL: URL, start: Double, length: Double) throws {
    try? FileManager.default.removeItem(at: outURL)
    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
      throw MediaError(message: "The sound of this video can't be saved.")
    }
    session.outputURL = outURL
    session.outputFileType = .m4a
    session.timeRange = CMTimeRange(
      start: CMTime(seconds: start, preferredTimescale: 600),
      duration: CMTime(seconds: length, preferredTimescale: 600)
    )
    let done = DispatchSemaphore(value: 0)
    session.exportAsynchronously { done.signal() }
    done.wait()
    guard session.status == .completed else {
      throw session.error ?? MediaError(message: "The sound could not be saved.")
    }
  }

  private static func url(_ s: String) -> URL? {
    if s.hasPrefix("file://") { return URL(string: s) }
    if s.hasPrefix("/") { return URL(fileURLWithPath: s) }
    return nil
  }

  private static func size(of url: URL) -> Int64 {
    let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey, .fileAllocatedSizeKey, .isDirectoryKey]
    let values = try? url.resourceValues(forKeys: Set(keys))
    if values?.isDirectory != true {
      return Int64(values?.totalFileAllocatedSize ?? values?.fileAllocatedSize ?? 0)
    }
    var total: Int64 = 0
    if let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: keys) {
      for case let file as URL in walker {
        let v = try? file.resourceValues(forKeys: Set(keys))
        if v?.isDirectory == true { continue }
        total += Int64(v?.totalFileAllocatedSize ?? v?.fileAllocatedSize ?? 0)
      }
    }
    return total
  }
}
