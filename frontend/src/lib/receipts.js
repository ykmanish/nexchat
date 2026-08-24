'use client';

import { api } from './api';
import { vault } from './vault';
import * as C from './crypto';
import { canonical } from './forensics-core';

/**
 * Signing a receipt when this device deletes a message on someone else's order.
 *
 * "Delete for everyone" is normally a promise with nothing behind it: the sender
 * sees a tombstone and takes it on faith. This turns it into a checkable claim.
 * After the local copy is gone, the device signs a short statement saying so with
 * the same key it signs forensic exports with, and the server — which already
 * holds the matching public key — refuses anything that does not verify.
 *
 * The receipts are hash-chained per device per conversation, so a receipt quietly
 * dropped later leaves a gap that shows. That is the only reason the chain tip
 * has to be fetched first rather than signing blind.
 *
 * Honest scope: this attests that *this device's stored copy is gone*. It cannot
 * speak for a screenshot, a photograph of a screen, or anything already copied
 * out of the app — which is the most any software can truthfully claim.
 */

/** Recovers the public half of the device signing key from the stored private one. */
async function devicePublicKey(pkcs8B64) {
  const priv = await crypto.subtle.importKey(
    'pkcs8',
    C.fromB64(pkcs8B64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );

  const jwk = await crypto.subtle.exportKey('jwk', priv);
  delete jwk.d;
  jwk.key_ops = ['verify'];

  const pub = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  return C.toB64(await crypto.subtle.exportKey('raw', pub));
}

/**
 * Confirms a deletion. Best effort by design.
 *
 * The local copy is already gone by the time this runs, so a failure here means
 * the confirmation is missing, not that the deletion did not happen. Better to
 * leave a gap in the ledger — which is visible — than to block the UI or, worse,
 * to make the deletion conditional on the network.
 */
export async function confirmDeletion({ messageId, conversationId }) {
  try {
    const me = await vault.activeUserId();
    const identity = me ? await vault.loadIdentity(me) : null;
    if (!identity?.deviceSigningPrivateKey) return null;

    // The chain tip decides what this receipt follows.
    const { data: tipData } = await api.get(
      '/messages/deletion-chain/' + conversationId + '/tip'
    );

    const statement = {
      messageId: String(messageId),
      conversationId: String(conversationId),
      deviceId: identity.deviceId,
      deletedAt: new Date().toISOString(),
      prevHash: tipData.tip ?? null,
    };

    const key = await C.importSigningPrivate(identity.deviceSigningPrivateKey);
    const signature = await C.sign(key, canonical(statement));

    const { data } = await api.post('/messages/' + messageId + '/deletion-receipts', {
      deletedAt: statement.deletedAt,
      prevHash: statement.prevHash,
      signature,
      publicKey: await devicePublicKey(identity.deviceSigningPrivateKey),
    });

    return data.receipt;
  } catch {
    return null;
  }
}

/** Who has confirmed a deletion, and whose devices have not. */
export async function statusFor(messageId) {
  const { data } = await api.get('/messages/' + messageId + '/deletion-receipts');
  return data;
}

/** One device's chain in one conversation, with the gap check already replayed. */
export async function chainFor(conversationId, deviceId) {
  const { data } = await api.get('/messages/deletion-chain/' + conversationId + '/' + deviceId);
  return data;
}
