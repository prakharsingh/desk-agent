import path from 'node:path';

/** Where the packaged app ships the display helper, relative to `Desk Agent.app/Contents`. */
export const PACKAGED_HELPER_DIR = 'Helpers';
export const DISPLAY_HELPER_NAME = 'desk-agent-display-helper';

/**
 * The packaged helper: `Contents/Helpers`, outside the asar. Never `Contents/MacOS`: the helper runs an
 * AppKit app object (ScreenCaptureKit creates one regardless), and from `Contents/MacOS` LaunchServices
 * registered it as a second "Desk Agent" (com.deskagent.mac), so the user's `quit app "Desk Agent"`
 * reached the helper instead of Electron main (F-O4). `execPath` is `Contents/MacOS/Desk Agent`.
 */
export function packagedDisplayHelperPath(execPath: string): string {
  return path.join(path.dirname(execPath), '..', PACKAGED_HELPER_DIR, DISPLAY_HELPER_NAME);
}
