Pod::Spec.new do |s|
  s.name           = 'ReelVaultMedia'
  s.version        = '1.0.0'
  s.summary        = 'Small thumbnails and storage housekeeping.'
  s.description    = 'Video frames at a set size, image shrinking, folder sizes and clearing old temporary files.'
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
