"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, fetchMessageHistory, type ChatMessage } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useSocket } from "@/lib/use-socket";

type SystemNote = { id: string; text: string };

export default function ChatRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const router = useRouter();
  const { token, user, isLoading: authLoading } = useRequireAuth();
  const { socket, state: connectionState } = useSocket(token);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notes, setNotes] = useState<SystemNote[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load message history over plain REST as soon as we have a token —
  // this doesn't depend on the socket being connected, so history shows
  // up immediately even if the real-time connection is still handshaking.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    fetchMessageHistory(token, roomId)
      .then((result) => {
        if (!cancelled) setMessages(result.messages);
      })
      .catch((err) => {
        if (!cancelled) {
          setHistoryError(err instanceof ApiError ? err.message : "Could not load message history.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, roomId]);

  // Join the room over the socket once it's connected, and wire up
  // listeners for new messages / presence notes. All torn down on
  // unmount or roomId change so switching rooms doesn't leave stale
  // listeners attached to old rooms.
  useEffect(() => {
    if (!socket || connectionState !== "connected") return;

    let cancelled = false;

    socket.emit("room:join", { roomId }, (response: { ok: boolean; error?: string }) => {
      if (cancelled) return;
      if (!response.ok) {
        setHistoryError(response.error ?? "Could not join room.");
        return;
      }
      setHasJoined(true);
    });

    function handleNewMessage({ roomId: incomingRoomId, message }: { roomId: string; message: ChatMessage }) {
      if (incomingRoomId !== roomId) return;
      setMessages((prev) => [...prev, message]);
    }

    function handleUserJoined({ roomId: incomingRoomId, username }: { roomId: string; username: string }) {
      if (incomingRoomId !== roomId) return;
      setNotes((prev) => [...prev, { id: `${Date.now()}-join`, text: `${username} joined the room.` }]);
    }

    function handleUserLeft({ roomId: incomingRoomId, username }: { roomId: string; username: string }) {
      if (incomingRoomId !== roomId) return;
      setNotes((prev) => [...prev, { id: `${Date.now()}-leave`, text: `${username} left the room.` }]);
    }

    socket.on("message:new", handleNewMessage);
    socket.on("room:user-joined", handleUserJoined);
    socket.on("room:user-left", handleUserLeft);

    return () => {
      cancelled = true;
      socket.emit("room:leave", { roomId });
      socket.off("message:new", handleNewMessage);
      socket.off("room:user-joined", handleUserJoined);
      socket.off("room:user-left", handleUserLeft);
      setHasJoined(false);
    };
  }, [socket, connectionState, roomId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, notes]);

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!socket || !draft.trim()) return;

    setSendError(null);
    setIsSending(true);
    socket.emit(
      "message:send",
      { roomId, content: draft },
      (response: { ok: boolean; error?: string; code?: string; data?: { retryAfterSeconds?: number } }) => {
        setIsSending(false);
        if (!response.ok) {
          const suffix =
            response.code === "RATE_LIMITED" && response.data?.retryAfterSeconds
              ? ` Try again in ${response.data.retryAfterSeconds}s.`
              : "";
          setSendError((response.error ?? "Could not send message.") + suffix);
          return;
        }
        setDraft("");
      }
    );
  }

  if (authLoading || !token) {
    return <main style={styles.page}>Loading…</main>;
  }

  const timeline = [
    ...messages.map((m) => ({ type: "message" as const, at: m.createdAt, data: m })),
    ...notes.map((n) => ({ type: "note" as const, at: "", data: n })),
  ];

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <Link href="/rooms" style={styles.backLink}>
          ← Rooms
        </Link>
        <div style={styles.statusBadge(connectionState)}>
          {connectionState === "connected" ? "● Live" : connectionState === "connecting" ? "Connecting…" : "Offline"}
        </div>
      </header>

      <div style={styles.messages} ref={scrollRef}>
        {isLoadingHistory ? (
          <p style={styles.muted}>Loading history…</p>
        ) : historyError ? (
          <p style={styles.error}>{historyError}</p>
        ) : timeline.length === 0 ? (
          <p style={styles.muted}>No messages yet. Say something.</p>
        ) : (
          timeline.map((item) =>
            item.type === "note" ? (
              <div key={item.data.id} style={styles.note}>
                {item.data.text}
              </div>
            ) : (
              <div key={item.data.id} style={styles.messageRow}>
                <span style={styles.messageAuthor(item.data.user.id === user?.id)}>{item.data.user.username}</span>
                <span style={styles.messageContent}>{item.data.content}</span>
              </div>
            )
          )
        )}
      </div>

      <form onSubmit={handleSend} style={styles.composer}>
        <input
          style={styles.composerInput}
          placeholder={hasJoined ? "Type a message…" : "Joining room…"}
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          disabled={!hasJoined}
          maxLength={2000}
        />
        <button style={styles.sendButton} disabled={!hasJoined || isSending || !draft.trim()}>
          Send
        </button>
      </form>
      {sendError && <p style={styles.sendError}>{sendError}</p>}
    </main>
  );
}

const styles: Record<string, any> = {
  page: { minHeight: "100vh", display: "flex", flexDirection: "column" },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 22px",
    borderBottom: "1px solid var(--line)",
    background: "#fff",
  },
  backLink: { fontSize: "0.9rem", color: "var(--slate)", textDecoration: "none" },
  statusBadge: (state: string) => ({
    fontSize: "0.78rem",
    fontFamily: "var(--font-mono)",
    color: state === "connected" ? "var(--signal)" : "var(--slate)",
  }),
  messages: { flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "10px" },
  muted: { color: "var(--slate)", fontSize: "0.95rem" },
  error: { color: "var(--danger)" },
  note: { fontSize: "0.8rem", color: "var(--slate)", fontStyle: "italic", textAlign: "center" },
  messageRow: { display: "flex", gap: "8px", alignItems: "baseline" },
  messageAuthor: (isSelf: boolean) => ({
    fontWeight: 600,
    fontSize: "0.85rem",
    color: isSelf ? "var(--signal)" : "var(--ink)",
    flexShrink: 0,
  }),
  messageContent: { fontSize: "0.95rem" },
  composer: { display: "flex", gap: "10px", padding: "16px 22px", borderTop: "1px solid var(--line)", background: "#fff" },
  composerInput: { flex: 1, padding: "11px 14px", borderRadius: "8px", border: "1px solid var(--line)" },
  sendButton: {
    padding: "11px 22px",
    borderRadius: "8px",
    border: "none",
    background: "var(--ink)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
  sendError: { color: "var(--danger)", fontSize: "0.85rem", padding: "0 22px 12px" },
};
