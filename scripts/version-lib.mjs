// Pure string transforms for release-time version bumps -- no file I/O here
// (see set-version.mjs for the CLI) so they stay trivially unit-testable.

const SEMVER = /^\d+\.\d+\.\d+$/;

function assertSemver(version) {
  if (!SEMVER.test(version)) {
    throw new Error(`not a plain semver (X.Y.Z): ${version}`);
  }
}

export function bumpPackageJson(content, version) {
  assertSemver(version);
  const pkg = JSON.parse(content);
  pkg.version = version;
  return JSON.stringify(pkg, null, 2) + '\n';
}

export function bumpGradle(content, version) {
  assertSemver(version);
  const codeMatch = content.match(/versionCode (\d+)/);
  if (!codeMatch) throw new Error('versionCode not found in build.gradle');
  if (!/versionName "[^"]*"/.test(content)) throw new Error('versionName not found in build.gradle');
  const nextCode = Number(codeMatch[1]) + 1;
  return content
    .replace(/versionCode \d+/, `versionCode ${nextCode}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);
}
