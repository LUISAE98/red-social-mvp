import { ConversationListSkeleton } from "@/components/chat/ChatSkeletons";

/** Bandeja de mensajes. Reusa el skeleton que ya usa la propia lista. */
export default function Loading() {
  return (
    <main style={{ minHeight: "100dvh", width: "100%" }}>
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", padding: "10px 14px" }}>
        <ConversationListSkeleton rows={7} />
      </div>
    </main>
  );
}
