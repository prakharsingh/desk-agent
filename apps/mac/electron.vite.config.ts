import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // coreHost is a separate entry (not an internal import of index.ts)
        // because CoreSupervisor spawns it as its own utilityProcess by file
        // path -- it needs its own output file under out/main/, not to be
        // bundled inline into index.js.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          coreHost: resolve(__dirname, 'src/main/coreHost.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Force CJS output (with an explicit .cjs extension, since the
        // package is "type":"module") -- Electron's ESM preload support left
        // window.deskAgent undefined in the packaged build (verified via the
        // packaged smoke test); CJS preload is the long-established,
        // reliably-working path regardless of the sandbox/contextIsolation
        // combination in use.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
  },
});
