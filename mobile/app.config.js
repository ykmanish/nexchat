const fs = require('fs');
const path = require('path');

/**
 * FCM is optional at build time.
 *
 * `google-services.json` is an account-specific file that has to come from the
 * operator's own Firebase project, so referencing it unconditionally would make
 * the app unbuildable for anyone who has not created one yet. When it is absent
 * the build still succeeds and the app falls back to its socket transport —
 * which is why that fallback exists.
 */
const googleServices = path.join(__dirname, 'google-services.json');
const hasFcm = fs.existsSync(googleServices);

module.exports = {
  expo: {
    name: 'Chax',
    slug: 'chax',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'chax',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    icon: './assets/icon.png',
    assetBundlePatterns: ['**/*'],

    android: {
      package: 'eu.nexarrow.chax',
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: './assets/icon-foreground.png',
        backgroundColor: '#0B141A',
      },
      ...(hasFcm ? { googleServicesFile: './google-services.json' } : {}),
      edgeToEdgeEnabled: true,
      permissions: [
        'android.permission.INTERNET',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.VIBRATE',
        'android.permission.WAKE_LOCK',
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
      ],
    },

    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-sqlite',
      [
        'expo-splash-screen',
        {
          image: './assets/splash.png',
          imageWidth: 180,
          backgroundColor: '#0B141A',
          dark: { backgroundColor: '#0B141A' },
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24,
            // Keeps the release APK to one artifact rather than per-ABI splits,
            // so "the APK" is a single file you can sideload anywhere.
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            /**
             * R8 keep rules. They live here rather than in
             * android/app/proguard-rules.pro because prebuild regenerates that
             * file, so a hand-edit there vanishes on the next run.
             *
             * WebRTC's JNI layer is reached from native code R8 cannot see, so
             * it has to be kept explicitly.
             *
             * Note what is deliberately *absent*: a blanket
             * `-dontwarn expo.modules.**`. R8 reported missing
             * `expo.modules.kotlin.*` classes, and silencing that turned a
             * build failure into a ClassNotFoundException at launch — strictly
             * worse, because the class really was not there. The cause was a
             * `expo-audio` depending on `expo-asset@57` — two SDKs ahead of
             * the core this SDK bundles. Using `expo-av` instead removes the
             * skew at its source.
             */
            extraProguardRules: [
              '-keep class org.webrtc.** { *; }',
              '-dontwarn org.webrtc.**',
              '-keep class com.oney.WebRTCModule.** { *; }',
            ].join('\n'),
          },
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: '#25D366',
          defaultChannel: 'messages',
        },
      ],
      [
        'expo-image-picker',
        { photosPermission: 'Chax needs your photos to send them in a chat.' },
      ],
      [
        'expo-av',
        { microphonePermission: 'Chax needs the microphone to record voice notes.' },
      ],
      [
        'expo-local-authentication',
        { faceIDPermission: 'Chax uses biometrics to unlock the app.' },
      ],
      /* WebRTC adds the camera/microphone plumbing and the JNI libraries the
         calling stack needs. Pinned to the plugin release that targets this
         SDK — the newer ones require Expo 56. */
      '@config-plugins/react-native-webrtc',
      './plugins/withReleaseSigning',
    ],

    extra: {
      apiUrl: process.env.CHAX_API_URL || 'https://chax.nexarrow.eu',
      hasFcm,
    },
  },
};
