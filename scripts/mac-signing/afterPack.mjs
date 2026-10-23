import path from 'node:path';
import { defaultExec, signApp } from './sign.mjs';

/** electron-builder afterPack hook: sign inside-out on macOS (mac.identity is null so nothing re-signs after us). */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const { mode, signed } = await signApp(appPath, { env: process.env, exec: defaultExec });
  console.log(`  • signed ${signed.length} code objects (${mode})`);
}
