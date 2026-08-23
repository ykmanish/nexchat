'use client';

import { use } from 'react';
import { Thread } from '@/components/chat/Thread';

export default function ChatThreadPage({ params }) {
  const { id } = use(params);
  return <Thread conversationId={id} />;
}
