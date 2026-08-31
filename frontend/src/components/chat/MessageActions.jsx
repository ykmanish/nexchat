'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CornerUpLeft,
  Copy,
  Forward,
  Trash2,
  Pencil,
  Star,
  Pin,
  CheckSquare,
  Plus,
  Info,
  MessagesSquare,
} from 'lucide-react';
import { useUI, toast } from '@/store/ui';
import { useChat } from '@/store/chat';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { ChoiceDialog } from '@/components/ui/Sheet';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const MENU_W = 216;
const PAD = 10;

/**
 * The band the user can actually see.
 *
 * `window.innerHeight` is the wrong number on a phone. It is the layout
 * viewport, which on Android Chrome still counts the strip behind a collapsing
 * URL bar, and it lags behind the on-screen keyboard. `visualViewport` is what
 * is on the glass right now, and its offset matters under pinch-zoom, where a
 * fixed element is positioned in layout coordinates but only part of it is
 * visible.
 */
function visibleBand() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) {
    return { left: vv.offsetLeft, width: vv.width, top: vv.offsetTop, height: vv.height };
  }
  return { left: 0, width: window.innerWidth, top: 0, height: window.innerHeight };
}

/**
 * Long-press / right-click menu. It anchors to the touch point, opens towards
 * whichever side of the finger has more room, keeps itself inside the visible
 * viewport at any height, and grows from the corner nearest the finger so the
 * motion reads as coming *from* the message.
 */
export function MessageActions({ conversation }) {
  const contextMenu = useUI((s) => s.contextMenu);
  const closeContextMenu = useUI((s) => s.closeContextMenu);
  const setReplyTo = useUI((s) => s.setReplyTo);
  const setEditing = useUI((s) => s.setEditing);
  const setForwarding = useUI((s) => s.setForwarding);
  const toggleSelection = useUI((s) => s.toggleSelection);
  const openSheet = useUI((s) => s.openSheet);
  const openReplies = useUI((s) => s.openReplies);

  const toggleReaction = useChat((s) => s.toggleReaction);
  const toggleStar = useChat((s) => s.toggleStar);

  /* The rule belongs to the chat, and the chat is right here as a prop — no
     need to go looking for it through the message. */
  const secret = !!conversation?.secret?.enabled;
  const togglePin = useChat((s) => s.togglePin);
  const deleteMessage = useChat((s) => s.deleteMessage);
  const plain = useChat((s) => s.plain);

  /* The message to delete is captured when Delete is pressed rather than read
     from `contextMenu` at confirm time: the confirmation dialog sits outside
     the menu panel, so interacting with it dismisses the menu and would leave
     `message` undefined by the time the delete runs. */
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  /* `null` until the menu has been measured and placed. */
  const [pos, setPos] = useState(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);

  const message = contextMenu?.message;
  const isMine = contextMenu?.isMine;

  /* Measure first, then place.
     Positioning used to run off an *estimated* height, with a second effect
     correcting it afterwards, which made the menu jump as it appeared. It is
     measured instead, and rendered hidden until that has happened —
     `visibility: hidden` still lays out, so it can be measured, and nothing is
     painted at the wrong place.

     Measuring alone was not enough, though. The menu is around 478px tall with
     a full action list, and the old pass only ever *moved* it, never sized it.
     Once the visible viewport was shorter than that — an on-screen keyboard
     takes a 740px phone down to about 380, and landscape is worse — no offset
     could fit it, so the clamp bottomed out at `PAD` for every touch point:
     the menu jumped to the top of the screen, hundreds of pixels from the
     finger, with the last few actions cut off below the fold and no way to
     reach them. Pressing a message near the top happened to look correct,
     because that is the one place where the top of the screen *is* next to
     your finger. Everything lower looked like the menu had failed to open.

     So the list is given a height budget and allowed to scroll inside it. Once
     the menu is guaranteed to fit the visible band, the clamp can always
     honour the anchor. */
  useLayoutEffect(() => {
    if (!contextMenu) {
      setPos(null);
      return undefined;
    }

    const place = () => {
      if (!menuRef.current) return;

      const vp = visibleBand();
      const minTop = vp.top + PAD;
      const maxBottom = vp.top + vp.height - PAD;
      const band = maxBottom - minTop;

      /* The reaction strip is never scrolled or shrunk; only the list is.
         Its height is derived by subtraction rather than measured directly so
         that this stays idempotent: `scrollHeight` is the list's full content
         height whatever cap is already on it, and the difference between the
         panel and the list as rendered is always the strip plus its margin. */
      const listRendered = listRef.current?.offsetHeight || 0;
      const listWanted = listRef.current?.scrollHeight || 0;
      const chrome = menuRef.current.offsetHeight - listRendered;
      /* No lower bound on this. A floor is tempting — three rows and a
         scrollbar is a poor menu — but any floor the band cannot afford puts
         rows back off the screen, which is the whole defect being fixed here.
         `height <= band` has to hold unconditionally, because it is what lets
         the clamp below always honour the anchor. */
      const listMax = Math.max(0, band - chrome);
      const listH = Math.min(listWanted, listMax);
      const height = chrome + listH;

      let left = contextMenu.x - MENU_W / 2;
      left = Math.max(vp.left + PAD, Math.min(left, vp.left + vp.width - MENU_W - PAD));

      /* Open towards whichever side of the finger has more room, rather than
         only flipping as a last resort. On a short viewport "fits below" is
         false almost everywhere, and treating that as an exception put the
         menu in the wrong place far more often than not. */
      const roomBelow = maxBottom - contextMenu.y;
      const roomAbove = contextMenu.y - minTop;
      const flipUp = roomBelow < roomAbove;

      // Opening down, the strip lands on the touch point and the list starts
      // just below it; opening up, the whole menu sits above the finger.
      const wanted = flipUp ? contextMenu.y - height : contextMenu.y - chrome;
      const top = Math.min(Math.max(minTop, wanted), Math.max(minTop, maxBottom - height));

      const originX = contextMenu.x - left < MENU_W / 2 ? 'left' : 'right';

      // Tagged with the menu it was computed for, so a stale position from the
      // previous open can never be treated as current.
      setPos({
        top,
        left,
        listMax,
        scrolls: listWanted > listMax,
        origin: (flipUp ? 'bottom ' : 'top ') + originX,
        for: contextMenu,
      });
    };

    place();

    /* Re-place while the menu is open. The keyboard collapsing is the common
       one: a long-press blurs the composer, the layout viewport grows back by
       ~350px, and a position measured against the shrunken one is left
       stranded. Orientation and the URL bar do the same thing more slowly. */
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    window.addEventListener('orientationchange', place);
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
    };
  }, [contextMenu]);

  const placed = !!pos && pos.for === contextMenu;

  /* Dismissal lives on the document rather than on the scrim.
     The scrim is a framer-motion element, so its React handler is wrapped and
     does not reliably receive a plain pointer event; and because a long-press
     opens this menu while the finger is still down, the scrim mounts under
     that finger and the release would close it instantly. Arming on the first
     pointerup consumes the gesture that opened the menu, so only a genuine
     new press outside the panel dismisses it. */
  useEffect(() => {
    if (!contextMenu) return undefined;

    let armed = false;
    const arm = () => {
      armed = true;
    };
    const onDown = (e) => {
      if (!armed) return;
      // The confirm dialog renders outside the panel; tapping it must not
      // tear down the menu state the dialog is still working from.
      if (confirmDelete) return;
      if (menuRef.current?.contains(e.target)) return;
      closeContextMenu();
    };

    document.addEventListener('pointerup', arm, { once: true, capture: true });
    // Android ends a claimed long-press with pointercancel rather than
    // pointerup; without this the menu would never become dismissable.
    document.addEventListener('pointercancel', arm, { once: true, capture: true });
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerup', arm, true);
      document.removeEventListener('pointercancel', arm, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [contextMenu, closeContextMenu, confirmDelete]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onKey = (e) => e.key === 'Escape' && closeContextMenu();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [contextMenu, closeContextMenu]);

  if (typeof document === 'undefined') return null;

  const editable =
    isMine &&
    !message?.deletedForEveryone &&
    message?.type === 'text' &&
    Date.now() - new Date(message?.createdAt).getTime() < 15 * 60_000;

  const actions = [
    {
      label: 'Message info',
      icon: Info,
      hidden: !isMine || message?.pending,
      onClick: () => openSheet('messageInfo', { message, conversation }),
    },
    { label: 'Reply', icon: CornerUpLeft, onClick: () => setReplyTo(message) },
    {
      label: message?.thread?.replyCount ? 'View replies' : 'Reply in thread',
      icon: MessagesSquare,
      // A reply already in a thread opens the thread it belongs to, rather than
      // starting a second one under itself.
      onClick: () => openReplies(message.threadRoot || message._id),
    },
    {
      label: 'Copy',
      icon: Copy,
      hidden: secret || !plain[message?._id]?.text,
      onClick: async () => {
        await navigator.clipboard.writeText(plain[message._id]?.text || '');
        toast.success('Copied');
      },
    },
    /* Forward, copy and star all take a message *out* of the chat, which is
       the one thing secret mode exists to stop. Hidden rather than shown and
       refused: an action that is always going to say no is just a place to be
       told off. */
    {
      label: 'Forward',
      icon: Forward,
      hidden: secret,
      onClick: () => setForwarding([message]),
    },
    {
      label: message?.starred ? 'Unstar' : 'Star',
      icon: Star,
      hidden: secret,
      onClick: () => toggleStar(message),
    },
    {
      label: message?.pinned ? 'Unpin' : 'Pin',
      icon: Pin,
      hidden: conversation?.type !== 'direct' && !conversation?.isAdmin,
      onClick: () => togglePin(message),
    },
    { label: 'Edit', icon: Pencil, hidden: !editable, onClick: () => setEditing(message) },
    { label: 'Select', icon: CheckSquare, onClick: () => toggleSelection(message._id) },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirmDelete(message) },
  ].filter((a) => !a.hidden);

  /* Deleting for everyone is only offered while it can still be honoured. */
  const withinRecall =
    isMine && Date.now() - new Date(message?.createdAt).getTime() < 2 * 60 * 60_000;

  const deleteChoices = [
    {
      label: 'Delete for me',
      sublabel: 'Removed from this device only',
      danger: true,
      onClick: () => runDelete('me'),
    },
    ...(withinRecall
      ? [
          {
            label: 'Delete for everyone',
            sublabel: 'Removed from every device in this chat',
            danger: true,
            onClick: () => runDelete('everyone'),
          },
        ]
      : []),
  ];

  async function runDelete(scope) {
    const target = confirmDelete;
    if (!target) return;

    setDeleting(true);
    try {
      await deleteMessage(target, scope);
      toast.success(scope === 'everyone' ? 'Deleted for everyone' : 'Message deleted');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
      closeContextMenu();
    }
  }

  return createPortal(
    <>
      <AnimatePresence>
        {contextMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              /* Purely visual — dismissal is handled on the document above. */
              onContextMenu={(e) => {
                e.preventDefault();
                closeContextMenu();
              }}
              className="fixed inset-0 z-[90] select-none bg-black/45"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', damping: 22, stiffness: 420, mass: 0.6 }}
              ref={menuRef}
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                transformOrigin: pos?.origin ?? 'top left',
                // Laid out but not painted until measured, so it never
                // appears at a stale position first.
                visibility: placed ? 'visible' : 'hidden',
              }}
              className="fixed z-[95] select-none"
            >
              {/* reaction strip */}
              {!message?.deletedForEveryone && (
                <div
                  className="mb-2 flex items-center gap-0.5 rounded-full bg-surface-raised p-1.5 shadow-pop"
                  style={{ width: MENU_W }}
                >
                  {QUICK_REACTIONS.map((emoji, i) => (
                    <motion.button
                      key={emoji}
                      type="button"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{
                        delay: 0.02 + i * 0.028,
                        type: 'spring',
                        damping: 11,
                        stiffness: 420,
                      }}
                      whileHover={{ scale: 1.25, y: -2 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        toggleReaction(message, emoji);
                        closeContextMenu();
                      }}
                      className="grid h-8 flex-1 place-items-center rounded-full text-[19px] leading-none transition-colors hover:bg-surface-2"
                    >
                      {emoji}
                    </motion.button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      openSheet('emojiPicker', { message });
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2"
                    aria-label="More reactions"
                  >
                    <Plus size={16} strokeWidth={2.4} />
                  </button>
                </div>
              )}

              {/* action list */}
              {/* Scrolls rather than overflowing the screen. Without a cap the
                  panel is taller than a phone in landscape or with the keyboard
                  up, and the actions past the fold are simply unreachable. */}
              <div
                ref={listRef}
                className={cn(
                  'rounded-xl bg-surface-raised py-1 shadow-pop',
                  pos?.scrolls ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'
                )}
                style={{ width: MENU_W, maxHeight: pos?.listMax }}
              >
                {actions.map((action, i) => (
                  <motion.button
                    key={action.label}
                    type="button"
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.03 + i * 0.018 }}
                    onClick={() => {
                      feedback('tap');
                      if (action.label !== 'Delete') closeContextMenu();
                      action.onClick();
                    }}
                    className={cn(
                      'flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors',
                      'hover:bg-surface-2 active:bg-surface-3',
                      action.danger && 'text-danger'
                    )}
                  >
                    <span className="text-[14.5px]">{action.label}</span>
                    <action.icon size={16} strokeWidth={1.9} className="opacity-60" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ChoiceDialog
        open={!!confirmDelete}
        onClose={() => {
          setConfirmDelete(null);
          closeContextMenu();
        }}
        title="Delete message?"
        message={
          withinRecall
            ? 'Deleting for everyone removes it from all devices in this chat.'
            : 'This removes the message from your device only.'
        }
        choices={deleteChoices}
        loading={deleting}
      />
    </>,
    document.body
  );
}
