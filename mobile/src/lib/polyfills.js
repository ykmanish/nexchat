import { getRandomValues } from 'expo-crypto';

/**
 * Browser globals the ported code assumes.
 *
 * Imported by `index.js` before anything else, because @noble reads
 * `globalThis.crypto` **once, at module load**, and keeps whatever it found:
 *
 *     exports.crypto = 'crypto' in globalThis ? globalThis.crypto : undefined;
 *
 * So this has to win the race, and it has to leave a real object in place —
 * replacing `globalThis.crypto` later would not reach a reference @noble has
 * already captured.
 */

/* Hermes has no `crypto` at all, so the property is created rather than
   patched. `defineProperty` because a bare assignment throws on some engines
   where the global object is sealed. */
function ensureCryptoObject() {
  if (typeof globalThis.crypto === 'object' && globalThis.crypto !== null) return globalThis.crypto;

  const host = {};
  try {
    globalThis.crypto = host;
  } catch {
    Object.defineProperty(globalThis, 'crypto', {
      value: host,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }
  return globalThis.crypto;
}

const cryptoObject = ensureCryptoObject();

if (typeof cryptoObject.getRandomValues !== 'function') {
  // expo-crypto is backed by Android's SecureRandom.
  try {
    cryptoObject.getRandomValues = getRandomValues;
  } catch {
    Object.defineProperty(cryptoObject, 'getRandomValues', {
      value: getRandomValues,
      configurable: true,
      writable: true,
    });
  }
}

/* Fail loudly here rather than four screens later. If this throws, the app is
   unusable anyway — every account starts with a generated key — and a crash at
   launch is far easier to diagnose than "sign-up does not work". */
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  throw new Error(
    'Chax could not install a secure random source. expo-crypto is missing or failed to link.'
  );
}

/**
 * Hermes ships Intl but not always TextEncoder/TextDecoder, and both are used
 * for every message body — so a small UTF-8 pair stands in rather than pulling
 * a package for two functions.
 */
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    encode(str) {
      const out = [];
      for (let i = 0; i < str.length; i += 1) {
        let code = str.charCodeAt(i);

        if (code < 0x80) {
          out.push(code);
        } else if (code < 0x800) {
          out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
          // Surrogate pair — emoji and anything else outside the BMP.
          const low = str.charCodeAt(i + 1);
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i += 1;
          out.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          );
        } else {
          out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
      }
      return new Uint8Array(out);
    }
  };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class TextDecoder {
    decode(bytes) {
      const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      let out = '';

      for (let i = 0; i < input.length; ) {
        const byte = input[i];

        if (byte < 0x80) {
          out += String.fromCharCode(byte);
          i += 1;
        } else if (byte < 0xe0) {
          out += String.fromCharCode(((byte & 0x1f) << 6) | (input[i + 1] & 0x3f));
          i += 2;
        } else if (byte < 0xf0) {
          out += String.fromCharCode(
            ((byte & 0x0f) << 12) | ((input[i + 1] & 0x3f) << 6) | (input[i + 2] & 0x3f)
          );
          i += 3;
        } else {
          const code =
            (((byte & 0x07) << 18) |
              ((input[i + 1] & 0x3f) << 12) |
              ((input[i + 2] & 0x3f) << 6) |
              (input[i + 3] & 0x3f)) -
            0x10000;
          out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
          i += 4;
        }
      }
      return out;
    }
  };
}
