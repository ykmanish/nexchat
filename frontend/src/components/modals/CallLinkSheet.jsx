'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Link2, Loader2, Trash2, Users, Video, Phone } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input, Switch, Segmented } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { toast } from '@/store/ui';
import { cn, chatTime } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Making and managing call links.
 *
 * A link is a capability, not an invitation: whoever holds it can join while it
 * is live. That is the useful part — you can hand it to somebody you have no
 * chat with — and it is why the controls here are all about narrowing it. An
 * expiry, a cap, an approval step, and a revoke button that works immediately.
 */

const EXPIRY = [
  { value: 2, label: '2 hours' },
  { value: 24, label: '1 day' },
  { value: 168, label: '1 week' },
];

export function CallLinkSheet({ open, onClose }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [mode, setMode] = useState('video');
  const [expiresInHours, setExpires] = useState(24);
  const [approvalRequired, setApproval] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setLoading(true);
    api
      .get('/calls/links')
      .then(({ data }) => setLinks(data.links))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  async function create() {
    setCreating(true);
    try {
      const { data } = await api.post('/calls/links', {
        name: name.trim() || null,
        mode,
        expiresInHours,
        approvalRequired,
      });
      setLinks((list) => [data.link, ...list]);
      setName('');
      feedback('success');
      // Copied on creation: a link nobody can paste is not much use, and the
      // clipboard write has to happen inside the gesture that made it.
      await copy(data.link.url, { quiet: true });
      toast.success('Link created and copied');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(code) {
    try {
      await api.delete('/calls/links/' + code);
      setLinks((list) => list.filter((l) => l.code !== code));
      toast.success('Link turned off');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Call links"
      subtitle="Share a link and anyone signed in can join, chat or no chat."
      size="md"
    >
      <div className="px-5 pb-6">
        <div className="mb-5 space-y-3 rounded-2xl bg-surface-2 p-4">
          <Input
            label="Name (optional)"
            placeholder="Monday standup"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />

          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-muted">Start as</p>
            <Segmented
              options={[
                { value: 'video', label: 'Video' },
                { value: 'audio', label: 'Voice' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </div>

          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink-muted">Expires after</p>
            <Segmented
              options={EXPIRY.map((e) => ({ value: e.value, label: e.label }))}
              value={expiresInHours}
              onChange={setExpires}
            />
          </div>

          <Switch
            label="Ask me before letting people in"
            sublabel="Guests wait until you admit them"
            checked={approvalRequired}
            onChange={setApproval}
          />

          <Button size="block" icon={Link2} loading={creating} onClick={create}>
            Create link
          </Button>
        </div>

        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
          Your links
        </p>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
          </div>
        ) : links.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13.5px] text-ink-muted">
            No links yet.
          </p>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <LinkRow key={link.code} link={link} onRevoke={() => revoke(link.code)} />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function LinkRow({ link, onRevoke }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
        {link.mode === 'audio' ? <Phone size={16} /> : <Video size={16} />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-medium">{link.name || 'Call link'}</p>
        <p className="truncate font-mono text-[12px] text-ink-muted">{link.code}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-faint">
          {link.expiresAt ? 'Expires ' + chatTime(link.expiresAt) : 'No expiry'}
          {link.joinCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users size={11} />
              {link.joinCount}
            </span>
          )}
        </p>
      </div>

      <button
        type="button"
        aria-label="Copy link"
        onClick={async () => {
          const ok = await copy(link.url);
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-3"
      >
        <motion.span key={copied ? 'yes' : 'no'} initial={{ scale: 0.7 }} animate={{ scale: 1 }}>
          {copied ? <Check size={16} className="text-brand-strong" /> : <Copy size={16} />}
        </motion.span>
      </button>

      <button
        type="button"
        aria-label="Turn off link"
        onClick={onRevoke}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

/**
 * Clipboard, with a fallback.
 *
 * `navigator.clipboard` needs a secure context and a live user gesture, and it
 * throws rather than degrading when it does not have them — so the old
 * execCommand path is still worth keeping for http origins and older Safari.
 */
async function copy(text, { quiet = false } = {}) {
  try {
    await navigator.clipboard.writeText(text);
    if (!quiet) feedback('success');
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (!ok) throw new Error('refused');
      if (!quiet) feedback('success');
      return true;
    } catch {
      if (!quiet) toast.error('Could not copy — long-press the link instead');
      return false;
    }
  }
}
