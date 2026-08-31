'use client';

import { useUI } from '@/store/ui';
import { NewMenuSheet, NewChatSheet, NewContactSheet, NewGroupSheet } from './NewChatSheets';
import { ChatInfoSheet } from './ChatInfoSheet';
import { ChatOptionsSheet, ChatListMenuSheet } from './ChatOptionsSheet';
import { ForwardSheet } from './ForwardSheet';
import { NewStorySheet, StoryViewerSheet } from './StorySheets';
import { NewPostSheet } from './NewPostSheet';
import { CommentsSheet } from './CommentsSheet';
import {
  SharePostSheet,
  PostLikesSheet,
  RepostSheet,
  PostOptionsSheet,
  EditPostSheet,
  PostAudienceSheet,
} from './PostSheets';
import { EmojiPickerSheet, MessageInfoSheet, ReactionDetailsSheet } from './MiscSheets';
import { NewPollSheet, PollVotersSheet } from './PollSheets';
import { GroupMembersSheet } from './GroupMembersSheet';
import { ModerationSheet } from './ModerationSheet';
import { CallLinkSheet } from './CallLinkSheet';
import { PasskeySheet } from './PasskeySheet';
import { FlipGestureSheet } from './FlipGestureSheet';
import { TiltRevealSheet } from './TiltRevealSheet';
import { ForensicExportSheet } from './ForensicExportSheet';
import { ReportScamSheet } from './ReportScamSheet';
import { SosSheet } from './SosSheet';
import { ShakeSosSheet } from './ShakeSosSheet';

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

      {/* ── feed ── */}
      <NewPostSheet open={type === 'newPost'} onClose={close} {...props} />
      <CommentsSheet open={type === 'comments'} onClose={close} {...props} />
      <SharePostSheet open={type === 'sharePost'} onClose={close} {...props} />
      <PostLikesSheet open={type === 'postLikes'} onClose={close} {...props} />
      <RepostSheet open={type === 'repost'} onClose={close} {...props} />
      <PostOptionsSheet open={type === 'postOptions'} onClose={close} {...props} />
      <EditPostSheet open={type === 'editPost'} onClose={close} {...props} />
      <PostAudienceSheet open={type === 'postAudience'} onClose={close} {...props} />

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
      <ForensicExportSheet open={type === 'forensicExport'} onClose={close} {...props} />
      <ReportScamSheet open={type === 'reportScam'} onClose={close} {...props} />
      <SosSheet open={type === 'sos'} onClose={close} />
      <ShakeSosSheet open={type === 'shakeSos'} onClose={close} />

      <ForwardSheet
        open={!!forwarding}
        messages={forwarding || []}
        onClose={() => useUI.getState().setForwarding(null)}
      />
    </>
  );
}
