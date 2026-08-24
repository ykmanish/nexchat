'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MapPin, Siren, TriangleAlert, X } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Textarea, RadioRow } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { useChat } from '@/store/chat';
import { toast } from '@/store/ui';
import * as sos from '@/lib/sos';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Setting up and triggering an emergency share.
 *
 * The setup and the trigger live in one place on purpose. Somebody who has just
 * configured their contacts should see immediately what pressing the button will
 * actually do, and somebody reaching for the button in a hurry should not have to
 * remember which of two screens it was on.
 *
 * The button is deliberately large, red, and requires a deliberate press. It is
 * also deliberately not a swipe or a long-press combination — under stress,
 * simple wins.
 */
export function SosSheet({ open, onClose }) {
  const conversations = useChat((s) => s.conversations);

  const [settings, setSettings] = useState(null);
  const [live, setLive] = useState(sos.active());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    sos.config.get().then(setSettings);
    setLive(sos.active());
  }, [open]);

  /* Everyone this account has a direct chat with — the only people it makes
     sense to send an emergency message to. */
  const people = conversations
    .filter((c) => c.type === 'direct' && c.peer)
    .map((c) => c.peer);

  const chosen = settings?.contactIds || [];

  const toggle = async (id) => {
    feedback('select');
    const next = chosen.includes(id)
      ? chosen.filter((x) => x !== id)
      : [...chosen, id].slice(0, 5);
    setSettings(await sos.config.set({ contactIds: next }));
  };

  async function trigger() {
    setBusy(true);
    try {
      const started = await sos.start({ onUpdate: setLive });
      setLive(started);
      feedback('error'); // an alarm, not a success chime
      toast.success('Emergency share started');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function halt() {
    setBusy(true);
    try {
      await sos.stop({ onUpdate: () => setLive(null) });
      setLive(null);
      toast.success('Location sharing stopped');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <Sheet open={open} onClose={onClose} title="Emergency share" size="md">
        <div className="grid place-items-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Emergency share"
      subtitle="One tap sends your location to the people you choose."
      size="md"
    >
      <div className="px-5 pb-6">
        {live ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3.5">
              <p className="flex items-center gap-2 text-[14px] font-semibold text-danger">
                <span className="h-2 w-2 animate-record-pulse rounded-full bg-danger" />
                Sharing your location
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                {live.sent} update{live.sent === 1 ? '' : 's'} sent to {live.contactIds.length}{' '}
                {live.contactIds.length === 1 ? 'person' : 'people'}. Updating every{' '}
                {Math.round(sos.UPDATE_EVERY_MS / 1000)} seconds.
              </p>
              {live.lastPosition ? (
                <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11.5px] text-ink-faint">
                  <MapPin size={12} />
                  {live.lastPosition.lat.toFixed(4)}, {live.lastPosition.lng.toFixed(4)} · ±
                  {live.lastPosition.accuracy}m
                </p>
              ) : (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-warn">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                  No location fix yet — your message was still sent.
                </p>
              )}
            </div>

            <Button size="block" variant="secondary" icon={X} loading={busy} onClick={halt}>
              I am OK — stop sharing
            </Button>
          </motion.div>
        ) : (
          <>
            <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              Emergency contacts {chosen.length > 0 && '· ' + chosen.length + ' of 5'}
            </p>

            {people.length === 0 ? (
              <p className="mb-4 rounded-xl bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
                Start a chat with someone first — an emergency message goes to a conversation,
                so there has to be one.
              </p>
            ) : (
              <div className="mb-4 max-h-[220px] space-y-1 overflow-y-auto">
                {people.map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => toggle(p._id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                      chosen.includes(p._id) ? 'bg-brand-tint' : 'hover:bg-surface-2'
                    )}
                  >
                    <Avatar src={p.avatar} name={p.name} color={p.avatarColor} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.name}</span>
                    {chosen.includes(p._id) && (
                      <span className="shrink-0 text-[12px] font-semibold text-brand-strong">
                        Added
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <Textarea
              label="Message they will receive"
              value={settings.message}
              onChange={(e) => setSettings({ ...settings, message: e.target.value })}
              onBlur={() => sos.config.set({ message: settings.message })}
              rows={2}
              maxLength={300}
            />

            <p className="mb-1 mt-4 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              Keep sharing for
            </p>
            <div className="mb-4 overflow-hidden rounded-xl bg-surface-2">
              {sos.DURATIONS.map((d, i) => (
                <div key={d.value}>
                  {i > 0 && <div className="divider mx-4" />}
                  <RadioRow
                    label={d.label}
                    checked={settings.durationMinutes === d.value}
                    onChange={async () =>
                      setSettings(await sos.config.set({ durationMinutes: d.value }))
                    }
                  />
                </div>
              ))}
            </div>

            <Button
              size="block"
              variant="danger"
              icon={Siren}
              loading={busy}
              disabled={chosen.length === 0}
              onClick={trigger}
            >
              Send emergency alert now
            </Button>

            <p className="mt-3 px-1 text-[12px] leading-relaxed text-ink-faint">
              Your location is sent as an ordinary encrypted message, so only these people can
              read it — not us. It sends even if a location fix fails, because reaching someone
              matters more than the map.
              {!sos.isSupported() && ' This device cannot report a location, so only the message will be sent.'}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
