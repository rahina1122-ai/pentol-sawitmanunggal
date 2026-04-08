const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'react-native-document-picker': path.resolve(
    __dirname,
    'react-native-document-picker-shim',
  ),
};

config.resolver.assetExts.push('wasm');

module.exports = config;
