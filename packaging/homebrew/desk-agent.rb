cask "desk-agent" do
  version "0.4.0"
  sha256 "REPLACE_WITH_SHA256_OF_DMG"

  url "https://github.com/prakharsingh/desk-agent/releases/download/v#{version}/DeskAgent-#{version}-mac-arm64.dmg"
  name "Desk Agent"
  desc "Turns a docked Android phone into a desk dashboard and honest presence sensor"
  homepage "https://github.com/prakharsingh/desk-agent"

  depends_on arch: :arm64

  app "Desk Agent.app"

  caveats <<~EOS
    Desk Agent is ad-hoc signed (free & open source, no Apple Developer
    membership). On first launch macOS will warn about an unidentified
    developer: right-click the app in /Applications and choose Open, once.
    Or install with: brew install --cask --no-quarantine desk-agent
  EOS
end
