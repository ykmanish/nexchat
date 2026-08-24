'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Copy,
  FileCheck2,
  Loader2,
  ScrollText,
  ShieldAlert,
  Stamp,
} from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Switch } from '@/components/ui/Field';
import { toast } from '@/store/ui';
import * as forensics from '@/lib/forensics';
import { formatBytes } from '@/lib/media';
import { chatTime } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Producing a tamper-evident export of one conversation.
 *
 * The design problem on this screen is expectation, not mechanics. Anyone
 * reaching for "export as evidence" assumes the result proves the other person
 * said what it says they said — and it does not, because messages carry no
 * sender signature and the recipient holds the same content key. Overstating
 * that would be worse than offering nothing, so the limitation is on the screen
 * before the button, not buried in a tooltip afterwards.
 */
export function ForensicExportSheet({ open, onClose, conversation }) {
  const [summary, setSummary] = useState(null);
  const [note, setNote] = useState('');
  const [attest, setAttest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !conversation) return;
    setResult(null);
    setNote('');
    setSummary(null);
    forensics
      .preview([conversation._id])
      .then(setSummary)
      .catch(() => setSummary({ count: 0 }));
  }, [open, conversation]);

  async function exportNow() {
    setBusy(true);
    try {
      const out = await forensics.exportToFile({
        conversationIds: [conversation._id],
        attest,
        note: note.trim() || null,
      });
      setResult(out);
      feedback('success');
      toast.success('Export sealed — ' + out.bundle.manifest.scope.recordCount + ' records');
    } catch (err) {
      feedback('error');
      toast.error(err.message || 'Could not produce the export');
    } finally {
      setBusy(false);
    }
  }

  const verifyCommand = result
    ? 'node scripts/verify-export.mjs ' + result.name
    : '';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Export as evidence"
      subtitle="A sealed, independently checkable copy of this conversation."
      size="md"
    >
      <div className="px-5 pb-6">
        {/* Stated first, deliberately. */}
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-warn/10 px-4 py-3">
          <ShieldAlert size={17} className="mt-0.5 shrink-0 text-warn" />
          <div className="text-[12.5px] leading-relaxed text-ink-muted">
            <p className="font-semibold text-ink">Read this before relying on it.</p>
            <p className="mt-1">
              This proves the records have not been altered since export and that
              <em> this device </em>
              produced them. It does <strong>not</strong> prove the other person wrote what
              is attributed to them — Chax messages carry no sender signature, so a recipient
              could construct one that decrypts correctly. That deniability is intentional.
            </p>
          </div>
        </div>

        {result ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-4 flex items-start gap-3 rounded-xl bg-brand-tint px-4 py-3">
              <FileCheck2 size={17} className="mt-0.5 shrink-0 text-brand-strong" />
              <div className="min-w-0 text-[12.5px] leading-relaxed text-ink-muted">
                <p className="font-semibold text-ink">{result.name}</p>
                <p className="mt-0.5">
                  {result.bundle.manifest.scope.recordCount} records ·{' '}
                  {formatBytes(result.size)} ·{' '}
                  {result.bundle.attestation
                    ? 'server-attested ' + chatTime(result.bundle.attestation.serverTime)
                    : 'not attested'}
                </p>
              </div>
            </div>

            <p className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              Merkle root
            </p>
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-ink-muted">
                {result.bundle.manifest.merkleRoot}
              </code>
              <button
                type="button"
                aria-label="Copy root"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.bundle.manifest.merkleRoot);
                    setCopied(true);
                    feedback('success');
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    toast.error('Could not copy — select it by hand');
                  }
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-3"
              >
                {copied ? <Check size={15} className="text-brand-strong" /> : <Copy size={15} />}
              </button>
            </div>

            <p className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              Verify it
            </p>
            <p className="mb-2 px-1 text-[12px] leading-relaxed text-ink-faint">
              The verifier is standalone — it needs Node and the file, not this app or an
              account.
            </p>
            <pre className="mb-4 overflow-x-auto rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-[11.5px] text-ink-muted">
              {verifyCommand}
            </pre>

            <Button size="block" variant="secondary" onClick={() => setResult(null)}>
              Export again
            </Button>
          </motion.div>
        ) : (
          <>
            <div className="mb-4 overflow-hidden rounded-xl bg-surface-2 px-4 py-3.5">
              <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                <ScrollText size={13} />
                Scope
              </p>

              {summary === null ? (
                <div className="py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />
                </div>
              ) : (
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                  {summary.count === 0 ? (
                    'Nothing decrypted on this device yet — there is nothing to export.'
                  ) : (
                    <>
                      <span className="font-medium text-ink">{summary.count} messages</span>{' '}
                      this device has decrypted and kept
                      {summary.from && (
                        <>
                          , from {chatTime(summary.from)} to {chatTime(summary.to)}
                        </>
                      )}
                      . Anything deleted locally, or never delivered here, is absent — and
                      its absence is not evidence.
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="mb-4 space-y-3">
              <Input
                label="Custody note (optional)"
                hint="Recorded in the manifest and covered by the signature"
                placeholder="e.g. Produced for case 12/2026"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
              />

              <div className="rounded-xl bg-surface-2 px-4 py-3.5">
                <Switch
                  label="Request a server timestamp"
                  sublabel={
                    attest
                      ? 'The server counter-signs the root, fixing when it existed'
                      : 'Without it, the only timestamp is this device clock'
                  }
                  checked={attest}
                  onChange={setAttest}
                />
              </div>
            </div>

            <Button
              size="block"
              icon={Stamp}
              loading={busy}
              disabled={!summary || summary.count === 0}
              onClick={exportNow}
            >
              Seal and download
            </Button>

            <p className="mt-3 px-1 text-[12px] leading-relaxed text-ink-faint">
              Only the Merkle root is sent for the timestamp — never your messages. The
              server cannot recover anything from it.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
