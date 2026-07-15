// CLI used by .releaserc.json's exec prepareCmd: node scripts/set-version.mjs <X.Y.Z>
// Must be run from the repo root (paths are root-relative).
import fs from 'node:fs';
import { bumpPackageJson, bumpGradle } from './version-lib.mjs';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/set-version.mjs <X.Y.Z>');
  process.exit(1);
}

const MAC_PKG = 'apps/mac/package.json';
const GRADLE = 'apps/android/android/app/build.gradle';

fs.writeFileSync(MAC_PKG, bumpPackageJson(fs.readFileSync(MAC_PKG, 'utf8'), version));
fs.writeFileSync(GRADLE, bumpGradle(fs.readFileSync(GRADLE, 'utf8'), version));
console.log(`set ${MAC_PKG} version + ${GRADLE} versionName to ${version}, versionCode +1`);
