// Scoped to app/ only, separate from the monorepo's root Vitest config
// (vitest.config.ts), which covers packages/* and app/'s pure-logic
// .test.ts files. This runner exists specifically for RN component
// (.test.tsx) tests, which Vitest's plain Rollup/esbuild pipeline cannot
// run -- react-native's package entry is raw Flow source requiring Metro's
// Babel transform, which only Jest's @react-native/jest-preset provides.
// The .test.ts / .test.tsx split keeps the two runners from ever
// double-running or fighting over the same files.
module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/src/**/*.test.tsx'],
  // The preset's own default transformIgnorePatterns anchors the
  // react-native-package allowlist immediately after "node_modules/"
  // (`node_modules/(?!(...)/)`), which assumes npm/yarn's flat layout.
  // pnpm nests every package under node_modules/.pnpm/<name>@<version>_.../
  // node_modules/<name>/, so the real package name never sits immediately
  // after the first "node_modules/" segment and the anchored pattern always
  // (wrongly) treats these as ignorable, plain-CJS deps -- breaking on the
  // very first ESM `import` inside the preset's own setup.js. Using `.*`
  // instead of anchoring lets the allowlist match anywhere later in the
  // path, tolerating pnpm's extra nesting regardless of depth.
  transformIgnorePatterns: ['/node_modules/(?!.*(?:react-native|@react-native))'],
  // This repo imports sibling .tsx/.ts files with a literal .js extension
  // (Metro's resolver strips it at bundle time; see AGENTS.md). Jest's
  // resolver has no equivalent behavior, so a plain `./Header.js` import
  // fails to resolve against the real `Header.tsx` file without this
  // mapping to strip the extension back off before Jest's own
  // moduleFileExtensions-based resolution runs.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['tsx', 'ts', 'jsx', 'js', 'json', 'node'],
};
