# Android release signing — one-time setup (repo owner)

The release APK is signed with a self-generated upload keystore. Free — no
Play account. **Losing this keystore breaks upgrade continuity for every
sideloaded install** (signature mismatch forces uninstall/reinstall), so
back it up offline.

## 1. Generate the keystore (once, on your Mac)

    keytool -genkeypair -v \
      -keystore desk-agent-upload.keystore \
      -alias desk-agent \
      -keyalg RSA -keysize 4096 -validity 10000

Pick a strong store password (reuse it as the key password when prompted —
one less secret to manage).

## 2. Back it up offline

Copy `desk-agent-upload.keystore` + the password to at least one offline
location (password manager attachment, encrypted USB). Not in the repo, not
only on this laptop.

## 3. Load it into GitHub Actions secrets

    gh secret set ANDROID_KEYSTORE_B64 --body "$(base64 -i desk-agent-upload.keystore)"
    gh secret set ANDROID_KEYSTORE_PASSWORD   # paste the store password
    gh secret set ANDROID_KEY_ALIAS --body "desk-agent"
    gh secret set ANDROID_KEY_PASSWORD        # paste the key password

## 4. Delete the local copy from the repo checkout (keep the backups)

The workflow (.github/workflows/release.yml) decodes the secret to
`apps/android/android/app/upload.keystore` at build time and exports the
`DESK_AGENT_UPLOAD_*` env vars that `app/build.gradle` reads. Local
`assembleRelease` without those vars falls back to the debug keystore —
fine for smoke tests, never for published artifacts.
