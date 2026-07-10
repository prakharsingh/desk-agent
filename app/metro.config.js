const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const workspaceRoot = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    unstable_enableSymlinks: true,
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // The project's source uses Node/NodeNext-style relative imports with an
    // explicit .js extension pointing at .ts source (e.g. './wsClient.js'),
    // which tsc resolves fine but Metro's resolver does not. Strip a
    // relative-import's trailing .js and retry so Metro finds the .ts file.
    resolveRequest: (context, moduleName, platform) => {
      if (/^\.\.?\//.test(moduleName) && moduleName.endsWith('.js')) {
        try {
          return context.resolveRequest(context, moduleName.slice(0, -3), platform);
        } catch {
          // fall through to default resolution below
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
