// Types shared across the main/preload/renderer process boundary. Pure
// type declarations only -- no runtime code, no Node built-ins -- so any
// process can import from here (as `import type`) without risking a
// bundler pulling Node-only code into the sandboxed renderer, the way
// importing types straight from a main-process module like binaries.ts
// would if that module ever gained a non-type-only export.
export interface BinaryStatus {
  adb: boolean;
  nowplayingCli: boolean;
}
