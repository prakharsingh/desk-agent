/**
 * Checks the stderr of `codesign -d -r- <path>`. A stable (self-signed)
 * identity yields a requirement pinned to a certificate hash -- `certificate
 * root = H"..."`, or `certificate leaf = H"..."` when the self-signed cert is
 * not trusted (leaf == root for a one-cert chain, so both are equally stable);
 * ad-hoc signatures produce a `cdhash` requirement that changes every build.
 *
 * opts.identifier: the identifier the requirement must contain.
 * opts.certHash:   the SHA-1 the pinned certificate hash must equal
 *                  (case-insensitive); omitted means any hash is accepted.
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
  const anchor = /certificate (?:root|leaf) = H"([0-9a-fA-F]*)"/.exec(line);
  if (!anchor) {
    problems.push('designated requirement has no certificate root/leaf hash anchor');
  } else if (opts.certHash && anchor[1].toLowerCase() !== String(opts.certHash).toLowerCase()) {
    problems.push(
      `designated requirement is pinned to certificate ${anchor[1].toLowerCase()}, expected ${String(opts.certHash).toLowerCase()}`,
    );
  }
  if (opts.identifier && !line.includes(`identifier "${opts.identifier}"`)) {
    problems.push(`designated requirement does not contain identifier "${opts.identifier}"`);
  }
  return { ok: problems.length === 0, problems };
}
