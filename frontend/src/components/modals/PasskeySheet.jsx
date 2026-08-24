'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, Loader2, ShieldCheck, Smartphone, Trash2, TriangleAlert } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { toast } from '@/store/ui';
import { useAuth } from '@/store/auth';
import * as passkeys from '@/lib/passkeys';
import * as C from '@/lib/crypto';
import { api } from '@/lib/api';
import { chatTime } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Managing the passkeys that can sign in to this account.
 *
 * The subtlety this screen has to communicate is that signing in and reading
 * your messages are two different problems. A passkey proves who you are; the
 * key that decrypts history is wrapped under the account password. Where the
 * authenticator supports the PRF extension we can wrap a second copy under it,
 * and then a new device needs nothing else — so enrolment asks for the password
 * once, here, in order to make that copy.
 *
 * Where it does not, the passkey still signs in and the password is asked for
 * once per new device instead. Both cases are labelled rather than hidden,
 * because "why did it ask for my password?" deserves an answer on screen.
 */
export function PasskeySheet({ open, onClose }) {
  const user = useAuth((s) => s.user);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState('idle'); // idle | naming
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [adding, setAdding] = useState(false);

  const supported = passkeys.isSupported();
  const blocked = passkeys.unsupportedReason();

  useEffect(() => {
    if (!open) return;
    setStage('idle');
    setName('');
    setPassword('');
    setLoading(true);
    passkeys
      .list()
      .then(setList)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  /**
   * Unwraps the account identity so it can be re-sealed under the PRF secret.
   *
   * Optional on purpose: leaving the password blank still enrols a working
   * passkey, it just cannot skip the password on a device that has never seen
   * this account. Better than refusing to enrol at all.
   */
  async function rawIdentity() {
    if (!password) return null;
    try {
      const { data } = await api.get('/auth/identity');
      const { raw } = await C.unwrapIdentity(data.encryptedIdentity, password);
      return raw;
    } catch (err) {
      throw new Error(
        err.message?.includes('Wrong password')
          ? 'That is not your account password'
          : err.message
      );
    }
  }

  async function add() {
    setAdding(true);
    try {
      const raw = await rawIdentity();
      const created = await passkeys.enrol({ name: name.trim(), rawIdentity: raw });

      setList((l) => [created, ...l]);
      setStage('idle');
      setName('');
      setPassword('');
      feedback('success');

      toast.success(
        created.unlocksIdentity
          ? 'Passkey added — this one can unlock your chats on a new device'
          : 'Passkey added'
      );
    } catch (err) {
      feedback('error');
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function remove(entry) {
    try {
      const { remaining } = await passkeys.remove(entry.id);
      setList((l) => l.filter((p) => p.id !== entry.id));
      toast.success(remaining === 0 ? 'Last passkey removed' : 'Passkey removed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Passkeys"
      subtitle="Sign in with your fingerprint, face or a security key."
      size="md"
    >
      <div className="px-5 pb-6">
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-brand-tint px-4 py-3">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand-strong" />
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            A passkey replaces your password at sign-in. Your chats are encrypted with a
            separate key, so give your password once below and this passkey can unlock them
            on a new device too.
          </p>
        </div>

        {stage === 'naming' ? (
          <div className="space-y-3">
            <Input
              label="Name this passkey"
              placeholder={'My ' + (isPhone() ? 'phone' : 'laptop')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
            />
            <Input
              type="password"
              label="Account password (optional)"
              hint="Lets this passkey unlock your chats on a new device"
              placeholder="Leave blank to skip"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />

            <div className="flex gap-3">
              <Button variant="secondary" size="block" onClick={() => setStage('idle')}>
                Cancel
              </Button>
              <Button size="block" loading={adding} onClick={add}>
                Create passkey
              </Button>
            </div>
          </div>
        ) : (
          <>
            {!supported ? (
              <div className="flex items-start gap-3 rounded-xl bg-surface-2 px-4 py-3">
                <TriangleAlert size={17} className="mt-0.5 shrink-0 text-ink-faint" />
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  {blocked || 'Passkeys are not available in this browser.'}
                </p>
              </div>
            ) : (
              <Button
                size="block"
                icon={KeyRound}
                onClick={() => {
                  feedback('select');
                  setStage('naming');
                }}
              >
                Add a passkey
              </Button>
            )}

            <p className="mb-2 mt-5 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              {list.length === 0 ? 'None yet' : 'On this account'}
            </p>

            {loading ? (
              <div className="grid place-items-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {list.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
                      {entry.deviceType === 'multiDevice' ? (
                        <Smartphone size={16} />
                      ) : (
                        <KeyRound size={16} />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium">
                        {entry.name}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-faint">
                        {[
                          entry.addedFrom,
                          entry.lastUsedAt
                            ? 'used ' + chatTime(entry.lastUsedAt)
                            : 'never used',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {/* Says out loud whether this one can skip the password,
                          because the difference is invisible otherwise. */}
                      <span
                        className={
                          entry.unlocksIdentity
                            ? 'mt-0.5 block text-[11px] font-medium text-brand-strong'
                            : 'mt-0.5 block text-[11px] text-ink-faint'
                        }
                      >
                        {entry.unlocksIdentity
                          ? 'Unlocks chats without your password'
                          : 'Asks for your password on a new device'}
                      </span>
                    </span>

                    <button
                      type="button"
                      aria-label={'Remove ' + entry.name}
                      onClick={() => remove(entry)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}

            {list.length > 0 && (
              <p className="mt-4 px-1 text-[12px] leading-relaxed text-ink-faint">
                Your password still works. Removing every passkey changes nothing except
                that you will be asked for it again.
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

const isPhone = () =>
  typeof navigator !== 'undefined' && /Mobi|Android|iPhone/.test(navigator.userAgent);
