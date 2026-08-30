const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * @noble/* ship their ESM under "exports" only. Metro resolves package exports
 * off by default in this SDK, and without this the crypto layer fails to
 * resolve at bundle time rather than at runtime.
 */
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
