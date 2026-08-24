'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, Link2Off, Users, Video, Phone, Clock } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { api } from '@/lib/api';
import { emitAsync, getSocket } from '@/lib/socket';
import { feedback } from '@/lib/sound';

/**
 * Joining a call by link.
 *
 * A lobby rather than an immediate join. Two reasons: the link may be dead and
 * saying so is kinder than a failed call, and dropping someone into a live call
 * with their camera on before they have looked at the screen is rude. So the
 * page describes what is behind the code and waits for a deliberate tap.
 *
 * Signing in is still required — the code is not identity. Anyone not signed in
 * is sent through the normal auth flow and comes back here.
 */
export default function CallLinkPage() {
  const { code } = useParams();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const setCall = useUI((s) => s.setCall);

  const [state, setState] = useState({ status: 'loading' });
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    api
      .get('/calls/links/' + code)
      .then(({ data }) => {
        if (cancelled) return;
        setState(
          data.link.live
            ? { status: 'ready', link: data.link }
            : { status: 'dead', reason: data.reason, link: data.link }
        );
      })
      .catch((err) => !cancelled && setState({ status: 'error', message: err.message }));

    return () => {
      cancelled = true;
    };
  }, [code]);

  async function join() {
    setJoining(true);
    try {
      const { data } = await api.post('/calls/links/' + code + '/join');

      // The socket has to be attached to the room before any signalling starts,
      // or the first offer arrives with nobody listening.
      const attached = await emitAsync('call:link-join', { code });
      if (!attached?.success) throw new Error(attached?.message || 'Could not join');

      if (data.pending) {
        setState((s) => ({ ...s, status: 'waiting' }));
        setJoining(false);
        return;
      }

      openCall(data);
    } catch (err) {
      setState({ status: 'error', message: err.message });
      setJoining(false);
    }
  }

  function openCall(data) {
    feedback('success');
    setCall({
      callId: data.callId,
      mode: data.mode,
      // A link call has no single peer to name, so the link's own name stands in.
      from: { id: null, name: state.link?.name || 'Call' },
      conversationName: state.link?.name || 'Call',
      isGroup: true,
      direction: data.isHost ? 'outgoing' : 'incoming',
      status: 'active',
      linkCode: code,
    });
    router.replace('/chats');
  }

  /* The host may admit us at any point after the knock. */
  useEffect(() => {
    if (state.status !== 'waiting') return;

    const socket = getSocket();
    if (!socket) return;

    const onAnswer = ({ allowed, callId, mode }) => {
      if (allowed) openCall({ callId, mode: mode || state.link?.mode, isHost: false });
      else setState({ status: 'refused' });
    };

    socket.on('call:knock-answered', onAnswer);
    return () => socket.off('call:knock-answered', onAnswer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  if (!user) {
    return (
      <Shell>
        <p className="text-[15px] text-ink-muted">Sign in to join this call.</p>
        <Button onClick={() => router.push('/login?next=/call/' + code)}>Sign in</Button>
      </Shell>
    );
  }

  if (state.status === 'loading') {
    return (
      <Shell>
        <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
      </Shell>
    );
  }

  if (state.status === 'dead' || state.status === 'error') {
    return (
      <Shell>
        <span className="grid h-16 w-16 place-items-center rounded-full bg-surface-2 text-ink-faint">
          <Link2Off size={26} />
        </span>
        <h1 className="font-display text-[20px] tracking-tight">
          {state.reason === 'revoked' ? 'That link was turned off' : 'That link has expired'}
        </h1>
        <p className="max-w-[280px] text-center text-[13.5px] leading-relaxed text-ink-muted">
          {state.message || 'Ask whoever shared it for a new one.'}
        </p>
        <Button variant="secondary" onClick={() => router.push('/chats')}>
          Back to chats
        </Button>
      </Shell>
    );
  }

  if (state.status === 'waiting' || state.status === 'refused') {
    return (
      <Shell>
        <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-tint text-brand-strong">
          {state.status === 'refused' ? <Link2Off size={26} /> : <Clock size={26} />}
        </span>
        <h1 className="font-display text-[20px] tracking-tight">
          {state.status === 'refused' ? 'Not admitted' : 'Waiting to be let in'}
        </h1>
        <p className="max-w-[280px] text-center text-[13.5px] leading-relaxed text-ink-muted">
          {state.status === 'refused'
            ? 'The host did not let you in.'
            : 'The host has been asked. This page will move on by itself.'}
        </p>
        <Button variant="secondary" onClick={() => router.push('/chats')}>
          Leave
        </Button>
      </Shell>
    );
  }

  const { link } = state;

  return (
    <Shell>
      <Avatar
        src={link.host.avatar}
        name={link.host.name}
        color={link.host.avatarColor}
        size="xl"
      />

      <div className="text-center">
        <h1 className="font-display text-[22px] tracking-tight">
          {link.name || 'Join call'}
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">{link.host.name} invited you</p>
      </div>

      <div className="flex items-center gap-4 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          {link.mode === 'audio' ? <Phone size={14} /> : <Video size={14} />}
          {link.mode === 'audio' ? 'Voice' : 'Video'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} />
          {link.activeCount === 0
            ? 'Nobody yet'
            : link.activeCount + (link.activeCount === 1 ? ' person' : ' people')}
        </span>
      </div>

      {link.full ? (
        <p className="text-[13.5px] font-medium text-danger">That call is full.</p>
      ) : (
        <Button
          size="lg"
          icon={link.mode === 'audio' ? Phone : Video}
          loading={joining}
          onClick={join}
        >
          {link.approvalRequired ? 'Ask to join' : 'Join now'}
        </Button>
      )}

      {link.approvalRequired && !link.full && (
        <p className="max-w-[260px] text-center text-[12px] text-ink-faint">
          The host lets people in one at a time.
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="app-shell grid place-items-center bg-app px-6"
    >
      <div className="flex w-full max-w-[320px] flex-col items-center gap-4">{children}</div>
    </motion.div>
  );
}
