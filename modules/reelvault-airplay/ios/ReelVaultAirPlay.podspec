Pod::Spec.new do |s|
  s.name           = 'ReelVaultAirPlay'
  s.version        = '1.0.0'
  s.summary        = 'The AirPlay button for playing videos on a TV.'
  s.description    = "Wraps Apple's AVRoutePickerView as a view."
  s.author         = 'ReelVault'
  s.homepage       = 'https://github.com/M7neeb/reelvault'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
