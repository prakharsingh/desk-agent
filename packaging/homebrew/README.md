# Homebrew tap

Users install with:

    brew tap prakharsingh/tap
    brew install --cask desk-agent

## One-time: create the tap repo

1. Create a public GitHub repo named exactly `homebrew-tap` under
   `prakharsingh` with a `Casks/` directory.
2. Copy `desk-agent.rb` into `Casks/desk-agent.rb`.

## Every release (step in the CONTRIBUTING.md checklist)

1. Download the published DMG and compute its hash:
       shasum -a 256 DeskAgent-<version>-mac-arm64.dmg
2. In this template AND in the tap repo's `Casks/desk-agent.rb`, update
   `version` and `sha256`, commit, push. `brew upgrade` picks it up.

The main `homebrew/cask` repo has notability requirements this project
doesn't meet yet; a personal tap has none. Revisit if the repo grows.
