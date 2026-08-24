'use client';

import { useUI } from '@/store/ui';
import { NewMenuSheet, NewChatSheet, NewContactSheet, NewGroupSheet } from './NewChatSheets';
import { ChatInfoSheet } from './ChatInfoSheet';
import { ChatOptionsSheet, ChatListMenuSheet } from './ChatOptionsSheet';
import { ForwardSheet } from './ForwardSheet';
import { NewStorySheet, StoryViewerSheet } from './StorySheets';
import { EmojiPickerSheet, MessageInfoSheet, ReactionDetailsSheet } from './MiscSheets';
import { NewPollSheet, PollVotersSheet } from './PollSheets';
import { GroupMembersSheet } from './GroupMembersSheet';
import { ModerationSheet } from './ModerationSheet';
import { CallLinkSheet } from './CallLinkSheet';
import { PasskeySheet } from './PasskeySheet';
import { FlipGestureSheet } from './FlipGestureSheet';
import { TiltRevealSheet } from './TiltRevealSheet';

/** One place that decides which sheet is on screen. */
export function SheetHost() {
  const sheet = useUI((s) => s.sheet);
  const forwarding = useUI((s) => s.forwarding);
  const close = useUI((s) => s.closeSheet);

  const type = sheet?.type;
  const props = sheet?.props || {};

  return (
    <>
      <NewMenuSheet open={type === 'new'} onClose={close} />
      <NewChatSheet open={type === 'newChat'} onClose={close} />
      <NewContactSheet open={type === 'newContact'} onClose={close} />
      <NewGroupSheet
        open={type === 'newGroup' || type === 'newCommunity'}
        mode={type === 'newCommunity' ? 'community' : 'group'}
        onClose={close}
      />

      <ChatInfoSheet open={type === 'chatInfo'} onClose={close} {...props} />
      <ChatOptionsSheet open={type === 'chatOptions'} onClose={close} {...props} />
      <ChatListMenuSheet open={type === 'chatListMenu'} onClose={close} />

      <NewStorySheet open={type === 'newStory'} onClose={close} />
      <StoryViewerSheet open={type === 'storyViewer'} onClose={close} {...props} />

      <EmojiPickerSheet open={type === 'emojiPicker'} onClose={close} {...props} />
      <MessageInfoSheet open={type === 'messageInfo'} onClose={close} {...props} />
      <ReactionDetailsSheet open={type === 'reactionDetails'} onClose={close} {...props} />

      <NewPollSheet open={type === 'newPoll'} onClose={close} {...props} />
      <PollVotersSheet open={type === 'pollVoters'} onClose={close} {...props} />
      <GroupMembersSheet open={type === 'groupMembers'} onClose={close} {...props} />
      <ModerationSheet open={type === 'moderation'} onClose={close} {...props} />
      <CallLinkSheet open={type === 'callLinks'} onClose={close} />
      <PasskeySheet open={type === 'passkeys'} onClose={close} />
      <FlipGestureSheet open={type === 'flipGesture'} onClose={close} />
      <TiltRevealSheet open={type === 'tiltReveal'} onClose={close} />

      <ForwardSheet
        open={!!forwarding}
        messages={forwarding || []}
        onClose={() => useUI.getState().setForwarding(null)}
      />
    </>
  );
}
