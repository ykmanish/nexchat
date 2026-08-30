import Constants from 'expo-constants';

/**
 * Where the app talks to.
 *
 * The deployed API terminates TLS at chax.nexarrow.eu and serves both the REST
 * routes under /api and the Socket.IO endpoint from the same origin, so one
 * value covers both. Overridable at build time with CHAX_API_URL for pointing a
 * debug build at a laptop.
 */
export const API_ORIGIN =
  Constants.expoConfig?.extra?.apiUrl?.replace(/\/+$/, '') || 'https://chax.nexarrow.eu';

export const API_BASE = API_ORIGIN + '/api';

/** True when the build was given a Firebase config and can use FCM. */
export const HAS_FCM = !!Constants.expoConfig?.extra?.hasFcm;
