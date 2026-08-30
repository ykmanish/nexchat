/**
 * One command from a clean checkout to an installable APK.
 *
 *   npm run apk
 *
 * Exists because the build needs three things that are not on a normal PATH —
 * a JDK 17, the Android SDK, and the signing key — and diagnosing "which of
 * those is missing" from a Gradle stack trace is miserable. Each is checked up
 * front with a sentence saying what to do about it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = platform() === 'win32';

const bold = (s) => '\x1b[1m' + s + '\x1b[0m';
const red = (s) => '\x1b[31m' + s + '\x1b[0m';
const green = (s) => '\x1b[32m' + s + '\x1b[0m';
const dim = (s) => '\x1b[2m' + s + '\x1b[0m';

function die(message, hint) {
  console.error('\n' + red('✗ ') + message);
  if (hint) console.error(dim('  ' + hint));
  process.exit(1);
}

/* ────────────────────────── locate the toolchain ────────────────────────── */

function findJdk() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

  // Common unmanaged installs, newest first.
  const roots = [
    join(homedir(), 'toolchain', 'jdk'),
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    '/usr/lib/jvm',
    '/Library/Java/JavaVirtualMachines',
  ];

  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    const candidates = readdirSync(dir)
      .filter((name) => /jdk|temurin|openjdk/i.test(name))
      .sort()
      .reverse();

    for (const name of candidates) {
      const home = join(dir, name);
      const binary = join(home, 'bin', isWindows ? 'java.exe' : 'java');
      if (existsSync(binary)) return home;
      // macOS nests it.
      const nested = join(home, 'Contents', 'Home');
      if (existsSync(join(nested, 'bin', 'java'))) return nested;
    }
  }
  return null;
}

function findSdk() {
  for (const value of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (value && existsSync(value)) return value;
  }

  const guesses = isWindows
    ? [join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')]
    : [join(homedir(), 'Android', 'Sdk'), join(homedir(), 'Library', 'Android', 'sdk')];

  return guesses.find((p) => p && existsSync(p)) || null;
}

const javaHome = findJdk();
if (!javaHome) {
  die(
    'No JDK 17 found.',
    'Install Temurin 17 from adoptium.net, or set JAVA_HOME to an existing one.'
  );
}

const version = execFileSync(join(javaHome, 'bin', isWindows ? 'java.exe' : 'java'), ['-version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const major = Number((version.match(/version "(\d+)/) || [])[1]);
if (major && major < 17) {
  die(`JAVA_HOME points at Java ${major}; React Native needs 17 or newer.`, javaHome);
}

const sdk = findSdk();
if (!sdk) {
  die(
    'No Android SDK found.',
    'Set ANDROID_HOME, or install cmdline-tools and run: sdkmanager "platforms;android-36" "build-tools;36.0.0"'
  );
}

if (!existsSync(join(sdk, 'platforms', 'android-36'))) {
  die(
    'Android platform 36 is not installed.',
    `sdkmanager --sdk_root="${sdk}" "platforms;android-36" "build-tools;36.0.0"`
  );
}

const signed = existsSync(join(root, 'credentials', 'signing.json'));

console.log(bold('\nBuilding Chax\n'));
console.log('  JDK      ' + javaHome);
console.log('  SDK      ' + sdk);
console.log('  signing  ' + (signed ? 'release key' : dim('debug key — not for distribution')));
console.log(
  '  FCM      ' +
    (existsSync(join(root, 'google-services.json'))
      ? 'google-services.json present'
      : dim('absent — the app will fall back to its socket transport'))
);
console.log('');

/* ────────────────────────────── build ────────────────────────────── */

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  PATH: join(javaHome, 'bin') + (isWindows ? ';' : ':') + process.env.PATH,
};

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: isWindows });
  if (result.status !== 0) die(`${command} ${args.join(' ')} failed.`);
}

run(isWindows ? 'npx.cmd' : 'npx', ['expo', 'prebuild', '--platform', 'android'], root);

const android = join(root, 'android');
run(isWindows ? 'gradlew.bat' : './gradlew', ['assembleRelease', '--no-daemon'], android);

/* ────────────────────────────── report ────────────────────────────── */

const apk = join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(apk)) {
  die('Gradle finished but no APK was produced.', apk);
}

const megabytes = (statSync(apk).size / (1024 * 1024)).toFixed(1);
console.log('\n' + green('✓ ') + bold(`APK ready — ${megabytes} MB`));
console.log('  ' + apk);
console.log(dim('\n  Install with:  adb install -r "' + apk + '"\n'));
