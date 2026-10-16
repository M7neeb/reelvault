import AVFoundation
import ExpoModulesCore
import UIKit

/// "Make Smaller": re-encodes a video with Apple's exporter (the same hardware
/// encoder the Camera app uses). HEVC presets keep quality while shrinking
/// H.264 and 4K files; the file's date and location metadata are carried over.
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

    Function("cancel") { (jobId: String) in
      DispatchQueue.main.async {
        self.sessions[jobId]?.cancelExport()
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
