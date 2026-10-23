/**
 * Checks the stderr of `codesign -d -r- <path>`. A stable (self-signed)
 * identity yields a requirement anchored on `certificate root = H"..."`;
 * ad-hoc signatures produce a `cdhash` requirement that changes every build.
 */
export function checkRequirement(codesignStderr, opts = {}) {
  const problems = [];
  const line = String(codesignStderr)
    .split('\n')
    .find((l) => l.includes('designated =>'));
  if (!line) {
    return { ok: false, problems: ['no "designated =>" line in codesign output'] };
  }
  if (line.includes('cdhash')) {
    problems.push('designated requirement is pinned to a cdhash (ad-hoc signature)');
  }
  if (!line.includes('certificate root = H"')) {
    problems.push('designated requirement has no certificate root anchor');
  }
  if (opts.identifier && !line.includes(`identifier "${opts.identifier}"`)) {
    problems.push(`designated requirement does not contain identifier "${opts.identifier}"`);
  }
  return { ok: problems.length === 0, problems };
}
