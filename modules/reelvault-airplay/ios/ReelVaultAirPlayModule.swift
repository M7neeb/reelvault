import AVKit
import ExpoModulesCore
import UIKit

/// The AirPlay button: Apple's own route picker, so tapping it lists the
/// Apple TVs and AirPlay TVs nearby. The video player allows external
/// playback, so the picked TV shows the video itself, not only the sound.
public class ReelVaultAirPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReelVaultAirPlay")

    Function("isAvailable") { () -> Bool in
      true
    }

    View(AirPlayButtonView.self) {
      Prop("tint") { (view: AirPlayButtonView, color: UIColor?) in
        view.picker.tintColor = color ?? .white
      }
      Prop("activeTint") { (view: AirPlayButtonView, color: UIColor?) in
        view.picker.activeTintColor = color ?? .systemBlue
      }
    }
  }
}

class AirPlayButtonView: ExpoView {
  let picker = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.prioritizesVideoDevices = true
    picker.tintColor = .white
    picker.backgroundColor = .clear
    addSubview(picker)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
  }
}
