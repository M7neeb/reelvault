import AVFoundation
import ExpoModulesCore
import PDFKit
import UIKit

/// Storage housekeeping for ReelVault: video frames written straight to a
/// small JPEG (instead of a full-resolution still plus a copy in the cache),
/// shrinking existing pictures, measuring folders, and clearing old temporary
/// files. Everything runs off the main thread.
public class ReelVaultMediaModule: Module {
  private let work = DispatchQueue(label: "reelvault.media", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("ReelVaultMedia")

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
