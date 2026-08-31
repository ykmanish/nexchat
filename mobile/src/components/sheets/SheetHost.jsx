import { useUI } from '../../store/ui';
import { NewMenuSheet, NewChatSheet, NewContactSheet, NewGroupSheet } from './NewChatSheets';
import { MessageActionsSheet } from './MessageActionsSheet';
import {
  EmojiPickerSheet,
  EditMessageSheet,
  ForwardSheet,
  MessageInfoSheet,
} from './MessageSheets';
import { ChatOptionsSheet, ChatInfoSheet } from './ChatSheets';
import { ChatListMenuSheet } from './ChatListMenuSheet';
import { AttachSheet } from './AttachSheet';

/**
 * One place that decides which sheet is on screen.
 *
 * Mirrors the web client's SheetHost: screens call `openSheet('newChat')`
 * rather than importing a modal and holding its open-state, so a sheet can be
 * raised from anywhere — a long-press two screens deep, a notification handler
 * — without prop-drilling.
 *
 * Mounted once in the root layout, above the navigator, so a sheet floats over
 * the tab bar the way it does on the web.
 */
export function SheetHost() {
  const sheet = useUI((s) => s.sheet);
  const close = useUI((s) => s.closeSheet);

  const type = sheet?.name;
  const props = sheet?.props || {};

  return (
    <>
      <NewMenuSheet open={type === 'new'} onClose={close} />
      <NewChatSheet open={type === 'newChat'} onClose={close} />
      <NewContactSheet open={type === 'newContact'} onClose={close} />
      <NewGroupSheet open={type === 'newGroup'} onClose={close} />

      <MessageActionsSheet open={type === 'messageActions'} onClose={close} {...props} />
      <EmojiPickerSheet open={type === 'emojiPicker'} onClose={close} {...props} />
      <EditMessageSheet open={type === 'editMessage'} onClose={close} {...props} />
      <ForwardSheet open={type === 'forward'} onClose={close} {...props} />
      <MessageInfoSheet open={type === 'messageInfo'} onClose={close} {...props} />

      <ChatOptionsSheet open={type === 'chatOptions'} onClose={close} {...props} />
      <ChatInfoSheet open={type === 'chatInfo'} onClose={close} {...props} />
      <ChatListMenuSheet open={type === 'chatListMenu'} onClose={close} />
      <AttachSheet open={type === 'attach'} onClose={close} {...props} />
    </>
  );
}
