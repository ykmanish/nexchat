# Tamper-evident forensic export

## Why this exists

An ordinary chat export is a text file, and anyone can edit a text file. Screenshots
are worse. Yet a chat transcript is one of the most commonly produced categories of
digital evidence, and the usual answer — "the investigator took a screenshot" — puts
the entire evidentiary weight on the investigator's word.

This produces an export a third party can check without trusting the exporter, the
app, or the server: every record hash-chained to the one before it, the whole set
summarised by a Merkle root, the root signed by the exporting device's key, and
optionally counter-signed by the server so the timestamp is not merely the
exporter's own clock.

It also states, inside the file, exactly what verifying it does *not* establish.
That second part is the more interesting half.

---

## The evidentiary model

### What a PASS establishes

| Property | Mechanism | Strength |
|---|---|---|
| **Integrity** — nothing added, removed, reordered or altered since export | SHA-256 hash chain + RFC 6962 Merkle root | Strong. Any edit is caught and localised to a numbered record. |
| **Origin** — a device holding a specific signing key produced this | ECDSA P-256 signature over the canonical manifest | Strong, conditional on the device key not being compromised. |
| **Anteriority** — the content existed no later than time *T* | Server counter-signature over the Merkle root | Moderate. First-party, not an audited TSA. |
| **Selective disclosure** — this one message was in the sealed set | Merkle inclusion proof | Strong. Discloses one record without revealing the others. |

### What a PASS does *not* establish

**It does not attribute a received message to its sender.** This is the important
limitation and it is not a defect in the export — it is a property of the messaging
protocol underneath.

In Chax, a message body is encrypted with AES-GCM under a random content key, and
that content key is sealed separately to each recipient device. The body carries no
signature from the sender. AES-GCM provides authenticity *to anyone holding the
key* — and the recipient holds the key. A recipient can therefore construct a
ciphertext that decrypts and authenticates perfectly, and no amount of
hash-chaining at export time can distinguish it from a genuine one.

This is **deniability**, and it is deliberate. It is what prevents a leaked
transcript from being cryptographic proof against its author. Signal, WhatsApp and
every other Double-Ratchet-derived protocol share this property for the same
reason.

The consequence for evidence is precise and worth stating plainly:

> A Chax forensic export is evidence of **what a particular device held and
> asserted at a particular time**. It is not evidence of what the other party
> said.

Additional limits:

- **Sent** messages are self-asserted by the exporting device and are not
  independently corroborated by the file.
- The export covers only what the device had **decrypted and retained**. Messages
  deleted locally, or never delivered to that device, are absent — and their
  absence is not evidence of anything.
- Attachment **bytes** are not included; only kind, size and URL are recorded.
- Without a server attestation, the only timestamp is the exporting device's clock,
  which the exporter controls.

---

## The research question

This is the tension worth writing about, and it does not have a settled answer:

> End-to-end encryption with deniability makes a transcript **unforgeable by a
> third party in transit** while simultaneously making it **unattributable to its
> author after the fact**. Both properties are intentional and they pull in
> opposite directions. How should an investigator or a court establish the
> authenticity of an E2EE chat export?

Some threads to pull:

1. **Corroboration over cryptography.** If the protocol cannot attribute, then
   attribution must come from elsewhere — device seizure, both parties' exports
   agreeing, server-side metadata (who talked to whom, when), or testimony. An
   export's role is then to make *tampering after seizure* detectable, not to
   prove authorship. That is a narrower but still valuable claim.
2. **Two-sided exports.** Two independent exports from two devices, both attesting
   the same message ids and content hashes, is materially stronger than one. It is
   also easy to check with the format below. Neither party can unilaterally
   fabricate agreement.
3. **Should messengers sign messages?** Adding a sender signature would make
   transcripts attributable — and would destroy deniability for everyone,
   permanently. That is a policy question disguised as an engineering one, and it
   is where a governance analysis belongs.
4. **Server metadata as corroboration.** The server never sees content, but it does
   see message ids, timestamps and participants. A defensible investigative
   protocol might pair a client export with a server-side metadata attestation.

---

## File format (`.chaxfx`, v1)

```jsonc
{
  "magic": "chax-forensic-export",
  "formatVersion": 1,

  "manifest": {
    "exportId": "…",                  // random; also the attestation lookup key
    "custody": {
      "exporterUserId": "…",
      "deviceId": "…",
      "exportedAt": "…",              // exporting device clock — untrusted
      "note": "Produced for case 12/2026"
    },
    "scope": {
      "conversationIds": ["…"],
      "recordCount": 7,
      "from": "…", "to": "…",
      "mediaBytesIncluded": false
    },
    "algorithms": { /* self-describing, so a verifier need not guess */ },
    "merkleRoot": "base64",
    "chainTip": "base64"              // hash of the final record
  },

  "records": [
    {
      "seq": 0,
      "prevHash": null,               // chain: null only on the first record
      "messageId": "…",
      "conversationId": "…",
      "senderId": "…", "senderName": "…",
      "direction": "sent" | "received",
      "sentAt": "…",
      "type": "text",
      "editedAt": null,
      "contentHash": "base64",        // over the canonical content object
      "hash": "base64",               // over the canonical header (all of the above)
      "content": { "text": "…", "attachments": [ … ] }
    }
  ],

  "signature":   { "alg": "ECDSA-P256-SHA256", "publicKey": "raw base64", "value": "base64" },
  "attestation": { "exportId": "…", "merkleRoot": "…", "recordCount": 7,
                   "serverTime": "…", "algorithm": "…", "signature": "…", "publicKey": "…" },
  "limitations": [ "…" ]
}
```

### Canonicalisation

Signatures are over bytes, so signer and verifier must agree byte-for-byte. All
signed structures are serialised as **sorted-key JSON with no insignificant
whitespace**, `undefined` dropped, UTF-8. `JSON.stringify` alone is *not* adequate:
it preserves insertion order, which differs the moment anything parses and
re-serialises.

### Why `contentHash` is separate from `hash`

The record header commits to `contentHash`, and the header is what is chained. A
record can therefore be disclosed with its `content` **redacted** and still verify
its place in the chain. Useful when only part of a conversation is relevant and the
rest is privileged or irrelevant.

---

## Verifying

```bash
node scripts/verify-export.mjs export.chaxfx
```

Stronger, fetching the authority key rather than trusting the copy in the file:

```bash
node scripts/verify-export.mjs export.chaxfx --authority https://api.example.com
```

The verifier imports nothing but Node built-ins. That is deliberate: a verifier
that required the application under examination would not be an independent check.

With `--authority` it does two extra things: fetches the authority's public key
from `/api/forensics/authority` instead of trusting the embedded copy, and asks
`/api/forensics/attestation/:exportId` whether the server *independently
remembers* attesting that root. A file whose attestation is not on record is
either forged or was produced offline — and either answer is informative.

The verifier reports each check separately, names the first record that fails, and
distinguishes three verdicts:

- **Verified** — every check passed.
- **Integrity intact; weaker claims unproven** — the records are sound but e.g.
  there is no attestation. Not a forgery.
- **FAILED** — altered or inauthentic.

It then reprints the limitations, so nobody reads a PASS as more than it is.

---

## Design decisions

**RFC 6962 Merkle hashing, not the Bitcoin variant.** Certificate Transparency
prefixes leaves with `0x00` and interior nodes with `0x01`, so a leaf can never be
reinterpreted as a node — without that domain separation, a second tree can be
constructed with the same root. It also splits odd rows rather than duplicating the
last node, which is the ambiguity that allowed two distinct Bitcoin trees to share
a root (CVE-2012-2459).

**First-party attestation, not RFC 3161 — and not a blockchain.** A real
Time-Stamping Authority is a trusted third party with an audited clock, and is the
correct answer for evidence intended for court. What is implemented here is the same
shape at lower assurance, and the file says so in `authority.assurance` so the two
are never confused. Swapping in a real TSA is a contained change.

A public blockchain was considered and rejected for the timestamp. Anchoring a
Merkle root on-chain gives public auditability, which an RFC 3161 TSA does not — but
it costs money per anchor, adds minutes-to-hours of latency, and permanently
publishes a value tied to a specific conversation's existence. For *timestamping*,
RFC 3161 is technically the better instrument. The place a ledger genuinely earns
its keep in this system is **key transparency** (detecting a server that swaps
identity keys), which is a different problem and is listed as future work.

**Hash chain *and* Merkle tree, not one or the other.** The chain makes tampering
localisable — "record 41 does not match" rather than "something changed". The tree
makes selective disclosure possible. Each does something the other cannot.

---

## Threat model for the export itself

| Adversary | Capability | Outcome |
|---|---|---|
| Recipient of the file | Edits message text | Caught: content digest mismatch, named record |
| " | Deletes, inserts or reorders records | Caught: chain break |
| " | Rebuilds chain *and* root to stay self-consistent | Caught: manifest signature fails |
| " | Swaps in an attestation from another export | Caught: attested root ≠ file root |
| " | Backdates `serverTime` | Caught: attestation signature fails |
| Exporter | Omits inconvenient messages | **Not caught.** Absence is not detectable. |
| Exporter | Backdates `exportedAt` | Caught only if a server attestation is present |
| Exporter | Fabricates a *received* message | **Not caught.** See deniability, above |
| Server operator | Denies having attested | Detectable if the file's attestation verifies against the published authority key |
| Anyone with the device signing key | Produces a fully valid export | **Not caught.** Key compromise is out of scope |

The two entries that are *not caught* are the honest boundary of this design, and
both are consequences of the protocol rather than the format.

---

## Future work

- **Sender signatures as an opt-in mode.** A per-conversation "attributable mode"
  where both parties consent to sign their messages, trading deniability for
  attribution. The policy question is more interesting than the code.
- **RFC 3161 TSA integration** for court-grade timestamps.
- **Key transparency log** so a swapped identity key is detectable — the legitimate
  use of an append-only ledger here.
- **Two-sided export comparison tool** — diff two exports from opposite ends of a
  conversation and report agreement, which is the strongest attribution available
  without breaking deniability.
- **Server-side metadata attestation** to corroborate that a message id existed,
  when, and between whom, without disclosing content.

---

## Files

| Path | Role |
|---|---|
| `frontend/src/lib/forensics-core.js` | Canonical JSON, SHA-256, RFC 6962 Merkle tree, inclusion proofs |
| `frontend/src/lib/forensics.js` | Record construction, manifest, device signing, export |
| `frontend/src/components/modals/ForensicExportSheet.jsx` | The export UI, limitations stated before the button |
| `backend/src/services/attestation.js` | Attestation authority key and signing |
| `backend/src/controllers/forensics.controller.js` | `attest`, `authority`, public lookup |
| `backend/scripts/verify-export.mjs` | Standalone verifier — no dependencies |
| `backend/scripts/forensics.test.mjs` | 17 tests: conformance, tamper detection, end-to-end |

Run `npm run test:forensics` in `backend/`.

**Operational note.** Set `FORENSIC_ATTEST_KEY` in `backend/.env` before relying on
any export. Without it the server mints an ephemeral key on boot and every
attestation it issues becomes unverifiable at the next restart — the server logs
this loudly with the key to persist.
