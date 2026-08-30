import { getRandomValues } from 'expo-crypto';

/**
 * The few browser globals the ported code assumes.
 *
 * Imported for its side effects at the very top of the root layout, before
 * anything that touches crypto. React Native's JS engine has no
 * `crypto.getRandomValues`, and @noble reaches for it when minting private
 * keys — without this, key generation throws at the first sign-up.
 */
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {};
}

if (typeof globalThis.crypto.getRandomValues !== 'function') {
  // expo-crypto is backed by Android's SecureRandom. Assigning through
  // defineProperty because the host object is sometimes a frozen accessor.
  try {
    globalThis.crypto.getRandomValues = getRandomValues;
  } catch {
    Object.defineProperty(globalThis.crypto, 'getRandomValues', {
      value: getRandomValues,
      configurable: true,
    });
  }
}

/**
 * Hermes ships Intl but not always a `TextEncoder`/`TextDecoder` pair. Both are
 * used for every message body, so a tiny UTF-8 implementation stands in rather
 * than pulling a polyfill package for two functions.
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
