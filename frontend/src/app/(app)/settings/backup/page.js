'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CloudUpload,
  Download,
  HardDriveDownload,
  Loader2,
  Lock,
  MonitorSmartphone,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  SettingsShell,
  SettingsGroup,
  SettingsRow,
  Divider,
} from '@/components/layout/SettingsShell';
import { Input, Switch } from '@/components/ui/Field';
import { Button, ListButton } from '@/components/ui/Button';
import { ChoiceDialog } from '@/components/ui/Sheet';
import { toast } from '@/store/ui';
import * as backup from '@/lib/backup';
import * as devicesync from '@/lib/devicesync';
import { formatBytes } from '@/lib/media';
import { chatTime } from '@/lib/utils';
import { feedback } from '@/lib/sound';

/**
 * Backup and restore.
 *
 * The thing worth being honest about on this screen is what a backup is *for*.
 * The server already holds every message as ciphertext; what it does not hold is
 * the keys, and those live only in this browser. So "clear site data" and "lost
 * laptop" are the same event, and this page is the only thing standing between
 * that event and losing the readable history for good.
 *
 * Which is also why the passphrase warning is as blunt as it is. There is no
 * reset link. That is not an oversight — a backup a support desk could open is
 * not an encrypted backup.
 */
export default function BackupPage() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const [passphrase, setPassphrase] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [syncState, setSyncState] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [restorePass, setRestorePass] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const fileInput = useRef(null);

  const refresh = () =>
    backup.remote
      .info()
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));

  const refreshSync = () =>
    devicesync
      .status()
      .then(setSyncState)
      .catch(() => setSyncState(null));

  useEffect(() => {
    refresh();
    refreshSync();
  }, []);

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await devicesync.sync({ force: true });
      await refreshSync();
      feedback('success');

      const pulled = result?.pulled?.counts?.messages || 0;
      toast.success(
        pulled > 0 ? 'Pulled in ' + pulled + ' messages' : 'Everything is up to date'
      );
    } catch (err) {
      feedback('error');
      toast.error(err.message || 'Could not sync');
    } finally {
      setSyncing(false);
    }
  }

  const passOk = passphrase.length >= 8 && passphrase === confirmPass;

  async function run(kind, fn) {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      feedback('error');
      toast.error(err.message || 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  const exportFile = () =>
    run('file', async () => {
      const result = await backup.exportToFile(passphrase, { includeMedia });
      feedback('success');
      toast.success(
        'Saved ' + result.name + ' · ' + result.stats.messages + ' messages'
      );
      setPassphrase('');
      setConfirmPass('');
    });

  const uploadToServer = () =>
    run('server', async () => {
      const saved = await backup.remote.upload(passphrase, { includeMedia });
      setInfo(saved);
      feedback('success');
      toast.success('Backup stored');
      setPassphrase('');
      setConfirmPass('');
    });

  const restoreFromServer = () =>
    run('restore-server', async () => {
      const payload = await backup.remote.download(restorePass);
      const counts = await backup.restore(payload);
      feedback('success');
      toast.success('Restored ' + counts.messages + ' messages');
      setRestorePass('');
    });

  const restoreFromFile = () =>
    run('restore-file', async () => {
      const archive = await backup.readFile(pendingFile);
      const payload = await backup.open(archive, restorePass);
      const counts = await backup.restore(payload);
      feedback('success');
      toast.success('Restored ' + counts.messages + ' messages');
      setPendingFile(null);
      setRestorePass('');
    });

  return (
    <SettingsShell title="Chat backup" subtitle="Keep a copy you can actually read">
      <SettingsGroup
        title="Device sync"
        footer="Your devices hand each other the messages they have already decrypted, sealed with a key only your account holds. It runs whenever you open Chax, and needs no passphrase — a message sent before a device was linked cannot be decrypted by it, so this is the only way that history can ever appear there."
      >
        <SettingsRow>
          <div className="flex items-start gap-3">
            <MonitorSmartphone size={17} className="mt-0.5 shrink-0 text-brand-strong" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">
                {syncState?.remote
                  ? syncState.behind
                    ? 'New history from another device'
                    : 'Up to date'
                  : 'Nothing shared yet'}
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {syncState?.remote
                  ? syncState.remote.stats.messages.toLocaleString() +
                    ' messages' +
                    (syncState.remote.deviceName
                      ? ' · last from ' + syncState.remote.deviceName
                      : '') +
                    ' · ' +
                    chatTime(syncState.remote.updatedAt)
                  : 'Open Chax on your other device and it will appear here.'}
              </p>
            </div>
          </div>
        </SettingsRow>
        <Divider />
        <SettingsRow>
          <Button
            size="block"
            variant="secondary"
            icon={RefreshCw}
            loading={syncing}
            onClick={syncNow}
          >
            Sync now
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Why this matters"
        footer="Messages on our servers are encrypted with keys that exist only in this browser. Without a backup, clearing site data or losing this device loses the readable history — the ciphertext survives, but nothing can open it."
      >
        <SettingsRow>
          <div className="flex items-start gap-3">
            <Lock size={17} className="mt-0.5 shrink-0 text-brand-strong" />
            <p className="text-[13px] leading-relaxed text-ink-muted">
              An archive is sealed with a passphrase you choose. We never see it, and there
              is no way to reset it — <strong className="text-ink">write it down</strong>.
            </p>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── stored copy ── */}
      <SettingsGroup title="Stored on our servers">
        {loading ? (
          <SettingsRow>
            <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />
          </SettingsRow>
        ) : info ? (
          <>
            <SettingsRow>
              <p className="text-[15px] font-medium">
                {info.stats.messages.toLocaleString()} messages
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {info.stats.conversations} chats · {formatBytes(info.size)} · updated{' '}
                {chatTime(info.updatedAt)}
                {info.deviceName ? ' from ' + info.deviceName : ''}
              </p>
            </SettingsRow>
            <Divider />
            <ListButton
              icon={Trash2}
              label="Delete stored backup"
              danger
              onClick={() => setConfirmDelete(true)}
            />
          </>
        ) : (
          <SettingsRow>
            <p className="text-[13.5px] text-ink-muted">Nothing stored yet.</p>
          </SettingsRow>
        )}
      </SettingsGroup>

      {/* ── make one ── */}
      <SettingsGroup
        title="Create a backup"
        footer="Media is left out by default — the keys in the archive can fetch it again from the server. Including it makes the file much larger."
      >
        <SettingsRow>
          <div className="space-y-3">
            <Input
              type="password"
              label="Passphrase"
              placeholder="At least 8 characters"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
            />
            <Input
              type="password"
              label="Confirm passphrase"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              autoComplete="new-password"
              error={
                confirmPass && confirmPass !== passphrase ? 'Those do not match' : undefined
              }
            />

            <Switch
              label="Include media"
              sublabel="Photos and videos already downloaded on this device"
              checked={includeMedia}
              onChange={setIncludeMedia}
            />

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="block"
                icon={Download}
                disabled={!passOk}
                loading={busy === 'file'}
                onClick={exportFile}
              >
                Save to a file
              </Button>
              <Button
                size="block"
                variant="secondary"
                icon={CloudUpload}
                disabled={!passOk}
                loading={busy === 'server'}
                onClick={uploadToServer}
              >
                Store on server
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── use one ── */}
      <SettingsGroup
        title="Restore"
        footer="Restoring merges into what is already here — nothing on this device is replaced or deleted."
      >
        <SettingsRow>
          <div className="space-y-3">
            <Input
              type="password"
              label="Passphrase for the archive"
              value={restorePass}
              onChange={(e) => setRestorePass(e.target.value)}
              autoComplete="current-password"
            />

            {pendingFile && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-ink-muted"
              >
                {pendingFile.name} · {formatBytes(pendingFile.size)}
              </motion.p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="block"
                variant="secondary"
                icon={Upload}
                onClick={() => fileInput.current?.click()}
              >
                Choose a file
              </Button>
              <Button
                size="block"
                icon={HardDriveDownload}
                disabled={!restorePass || (!pendingFile && !info)}
                loading={busy === 'restore-file' || busy === 'restore-server'}
                onClick={pendingFile ? restoreFromFile : restoreFromServer}
              >
                {pendingFile ? 'Restore from file' : 'Restore from server'}
              </Button>
            </div>

            {!info && !pendingFile && (
              <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-faint">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                There is nothing stored on the server, so pick a file.
              </p>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <input
        ref={fileInput}
        type="file"
        accept=".chaxbak,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setPendingFile(file);
          e.target.value = '';
        }}
      />

      <ChoiceDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete the stored backup?"
        message="The copy on our servers is removed. Any file you saved yourself is untouched."
        choices={[
          {
            label: 'Delete it',
            danger: true,
            onClick: async () => {
              setConfirmDelete(false);
              try {
                await backup.remote.remove();
                setInfo(null);
                toast.success('Stored backup deleted');
              } catch (err) {
                toast.error(err.message);
              }
            },
          },
        ]}
      />
    </SettingsShell>
  );
}
