module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Must be listed last per react-native-worklets docs.
    'react-native-worklets/plugin',
  ],
};
