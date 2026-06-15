"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  subscribeToLiveChat,
  sendLiveChatMessage,
  deleteLiveChatMessage,
} from "@/lib/liveChat/live-chat-service";
import type { LiveChatMessage } from "@/lib/liveChat/types";

export function useLiveChat(liveId: string | null) {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!liveId) {
      setMessages([]);
      return;
    }
    const unsub = subscribeToLiveChat(
      liveId,
      setMessages,
      (err) => console.warn("[useLiveChat]", err)
    );
    unsubRef.current = unsub;
    return () => { unsub(); unsubRef.current = null; };
  }, [liveId]);

  const send = useCallback(
    async (params: {
      userId: string;
      username: string;
      avatarUrl?: string | null;
      text: string;
    }) => {
      if (!liveId || !params.text.trim()) return;
      await sendLiveChatMessage({ liveId, ...params });
    },
    [liveId]
  );

  const deleteMessage = useCallback(
    async (messageId: string, deletedBy: string) => {
      if (!liveId) return;
      await deleteLiveChatMessage(liveId, messageId, deletedBy);
    },
    [liveId]
  );

  return { messages, send, deleteMessage };
}
