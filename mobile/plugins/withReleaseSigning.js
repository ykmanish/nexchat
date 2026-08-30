const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');

/**
 * Signs release builds with a real key instead of the debug one.
 *
 * `expo prebuild` regenerates `android/` from scratch, and the template it
 * writes points the release build type at `signingConfigs.debug` with a comment
 * telling you not to ship that. Editing the generated file by hand works until
 * the next prebuild silently reverts it — and an APK signed with the debug key
 * cannot be upgraded in place by one signed properly later, so getting this
 * wrong once means every tester has to uninstall.
 *
 * Credentials come from `credentials/signing.json`, which is gitignored. When
 * it is missing the plugin does nothing and the build falls back to debug
 * signing, so a fresh clone still builds something installable.
 */

const CREDENTIALS_DIR = 'credentials';
const CONFIG_FILE = 'signing.json';

function readCredentials(projectRoot) {
  const file = path.join(projectRoot, CREDENTIALS_DIR, CONFIG_FILE);
  if (!fs.existsSync(file)) return null;

  try {
    // A leading BOM is the normal result of writing this file from PowerShell
    // or Notepad, and JSON.parse rejects it — which would look exactly like
    // having no credentials at all and silently fall back to debug signing.
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    if (!parsed.storeFile || !parsed.storePassword || !parsed.keyAlias) return null;

    const keystore = path.join(projectRoot, CREDENTIALS_DIR, parsed.storeFile);
    if (!fs.existsSync(keystore)) return null;

    return { ...parsed, keystorePath: keystore };
  } catch {
    return null;
  }
}

module.exports = function withReleaseSigning(config) {
  // 1. Put the keystore where Gradle expects to find it.
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const credentials = readCredentials(mod.modRequest.projectRoot);
      if (!credentials) return mod;

      const destination = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        credentials.storeFile
      );
      fs.copyFileSync(credentials.keystorePath, destination);
      return mod;
    },
  ]);

  // 2. Teach build.gradle about it.
  return withAppBuildGradle(config, (mod) => {
    const credentials = readCredentials(mod.modRequest.projectRoot);
    if (!credentials) return mod;

    let contents = mod.modResults.contents;

    if (!contents.includes('signingConfigs.release')) {
      // Gradle rejects an unescaped backslash or quote in a password, so the
      // values go through a JSON-ish escape rather than straight interpolation.
      const quote = (value) => "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

      contents = contents.replace(
        /signingConfigs \{\s*\n(\s*)debug \{/,
        (match, indent) =>
          `signingConfigs {\n${indent}release {\n` +
          `${indent}    storeFile file(${quote(credentials.storeFile)})\n` +
          `${indent}    storePassword ${quote(credentials.storePassword)}\n` +
          `${indent}    keyAlias ${quote(credentials.keyAlias)}\n` +
          `${indent}    keyPassword ${quote(credentials.keyPassword || credentials.storePassword)}\n` +
          `${indent}}\n${indent}debug {`
      );

      contents = contents.replace(
        /(release \{\s*\n\s*\/\/ Caution![^\n]*\n\s*\/\/ see[^\n]*\n\s*)signingConfig signingConfigs\.debug/,
        '$1signingConfig signingConfigs.release'
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
