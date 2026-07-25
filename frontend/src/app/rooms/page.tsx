"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ApiError,
  createRoom,
  fetchConversationMessages,
  fetchRoomMessages,
  joinRoom,
  listConversations,
  listRooms,
  listUsers,
  startConversation,
  type ChatMessage,
  type Conversation,
  type Room,
  type UserSummary,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useSocket } from "@/lib/use-socket";

type ActiveTarget =
  | { type: "room"; id: string; title: string; subtitle: string }
  | { type: "conversation"; id: string; title: string; subtitle: string };

type SocketAck = { ok: boolean; error?: string; code?: string; data?: { retryAfterSeconds?: number } };

export default function RoomsPage() {
  const { logout } = useAuth();
  const { token, user, isLoading: authLoading } = useRequireAuth();
  const { socket, state: connectionState } = useSocket(token);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<ActiveTarget | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setIsLoading(true);

    Promise.all([listRooms(token), listUsers(token), listConversations(token)])
      .then(([roomResult, userResult, conversationResult]) => {
        if (cancelled) return;
        setRooms(roomResult.rooms);
        setUsers(userResult.users);
        setConversations(conversationResult.conversations);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load chat data.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !active) return;
    let cancelled = false;
    setIsLoadingMessages(true);
    setError(null);
    setSendError(null);
    setMessages([]);

    const request = active.type === "room" ? fetchRoomMessages(token, active.id) : fetchConversationMessages(token, active.id);
    request
      .then((result) => {
        if (!cancelled) setMessages(result.messages);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load messages.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, active]);

  useEffect(() => {
    if (!socket || connectionState !== "connected" || !active) return;

    const currentTarget = active;
    const joinEvent = currentTarget.type === "room" ? "room:join" : "conversation:join";
    const leaveEvent = currentTarget.type === "room" ? "room:leave" : "conversation:leave";
    const payload = currentTarget.type === "room" ? { roomId: currentTarget.id } : { conversationId: currentTarget.id };

    socket.emit(joinEvent, payload, (response: SocketAck) => {
      if (!response.ok) setError(response.error ?? "Could not join this chat.");
    });

    function handleNewMessage(event: { targetType: "room" | "conversation"; roomId?: string; conversationId?: string; message: ChatMessage }) {
      const matchesRoom = currentTarget.type === "room" && event.roomId === currentTarget.id;
      const matchesConversation = currentTarget.type === "conversation" && event.conversationId === currentTarget.id;
      if (!matchesRoom && !matchesConversation) return;
      setMessages((prev) => (prev.some((message) => message.id === event.message.id) ? prev : [...prev, event.message]));
      if (currentTarget.type === "conversation") {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === currentTarget.id
              ? { ...conversation, lastMessage: event.message, updatedAt: event.message.createdAt }
              : conversation
          )
        );
      }
    }

    socket.on("message:new", handleNewMessage);

    return () => {
      socket.emit(leaveEvent, payload);
      socket.off("message:new", handleNewMessage);
    };
  }, [socket, connectionState, active]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const filteredUsers = useMemo(() => {
    const value = filter.trim().toLowerCase();
    if (!value) return users;
    return users.filter((item) => item.username.toLowerCase().includes(value));
  }, [filter, users]);

  async function handleRoomClick(room: Room) {
    if (!token) return;
    setError(null);
    try {
      await joinRoom(token, room.id);
      setActive({ type: "room", id: room.id, title: `#${room.name}`, subtitle: `${room._count.members} members` });
      setRooms((prev) => prev.map((item) => (item.id === room.id ? { ...item, _count: { members: Math.max(item._count.members, room._count.members) } } : item)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open room.");
    }
  }

  async function handleCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!token || !newRoomName.trim()) return;
    setIsCreatingRoom(true);
    setError(null);
    try {
      const result = await createRoom(token, newRoomName);
      setRooms((prev) => [...prev, result.room]);
      setNewRoomName("");
      setActive({ type: "room", id: result.room.id, title: `#${result.room.name}`, subtitle: "1 member" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create room.");
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function handleStartConversation(targetUser: UserSummary) {
    if (!token) return;
    setError(null);
    try {
      const result = await startConversation(token, targetUser.id);
      setConversations((prev) => {
        const exists = prev.some((item) => item.id === result.conversation.id);
        return exists ? prev.map((item) => (item.id === result.conversation.id ? result.conversation : item)) : [result.conversation, ...prev];
      });
      setActive({
        type: "conversation",
        id: result.conversation.id,
        title: result.conversation.otherUser?.username ?? targetUser.username,
        subtitle: "Direct message",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open direct message.");
    }
  }

  function handleConversationClick(conversation: Conversation) {
    setActive({
      type: "conversation",
      id: conversation.id,
      title: conversation.otherUser?.username ?? "Direct message",
      subtitle: "Direct message",
    });
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!socket || !active || !draft.trim()) return;

    const content = draft;
    const payload = active.type === "room" ? { roomId: active.id, content } : { conversationId: active.id, content };
    setIsSending(true);
    setSendError(null);

    socket.emit("message:send", payload, (response: SocketAck) => {
      setIsSending(false);
      if (!response.ok) {
        const suffix = response.code === "RATE_LIMITED" && response.data?.retryAfterSeconds ? ` Try again in ${response.data.retryAfterSeconds}s.` : "";
        setSendError((response.error ?? "Could not send message.") + suffix);
        return;
      }
      setDraft("");
    });
  }

  if (authLoading || !token) {
    return <main className="chat-loading">Loading...</main>;
  }

  return (
    <main className="chat-page">
      <section className="chat-shell" aria-label="Chat application">
        <aside className="chat-sidebar">
          <header className="chat-brand-row">
            <div>
              <div className="chat-mark">RELAY</div>
              <div className="chat-user">{user?.username}</div>
            </div>
            <button className="icon-button" onClick={logout} title="Log out" aria-label="Log out">
              <span aria-hidden="true">-{">"}</span>
            </button>
          </header>

          <form className="new-room-form" onSubmit={handleCreateRoom}>
            <input
              value={newRoomName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewRoomName(e.target.value)}
              placeholder="Create room"
              maxLength={40}
            />
            <button disabled={isCreatingRoom || !newRoomName.trim()} title="Create room" aria-label="Create room">
              +
            </button>
          </form>

          <div className="sidebar-scroll">
            <div className="sidebar-section-title">Rooms</div>
            {rooms.map((room) => (
              <button
                key={room.id}
                className={`thread-button ${active?.type === "room" && active.id === room.id ? "is-active" : ""}`}
                onClick={() => handleRoomClick(room)}
              >
                <span className="avatar room-avatar">#</span>
                <span className="thread-copy">
                  <span className="thread-title">{room.name}</span>
                  <span className="thread-subtitle">{room._count.members} members</span>
                </span>
              </button>
            ))}

            <div className="sidebar-section-title with-gap">Direct messages</div>
            {conversations.length === 0 ? (
              <p className="sidebar-empty">Start a DM from the people list.</p>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`thread-button ${active?.type === "conversation" && active.id === conversation.id ? "is-active" : ""}`}
                  onClick={() => handleConversationClick(conversation)}
                >
                  <span className="avatar dm-avatar">{(conversation.otherUser?.username ?? "?").slice(0, 1).toUpperCase()}</span>
                  <span className="thread-copy">
                    <span className="thread-title">{conversation.otherUser?.username ?? "Direct message"}</span>
                    <span className="thread-subtitle">{conversation.lastMessage?.content ?? "No messages yet"}</span>
                  </span>
                </button>
              ))
            )}

            <div className="sidebar-section-title with-gap">People</div>
            <input className="people-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find user" />
            {filteredUsers.map((item) => (
              <button key={item.id} className="thread-button compact" onClick={() => handleStartConversation(item)}>
                <span className="avatar people-avatar">{item.username.slice(0, 1).toUpperCase()}</span>
                <span className="thread-copy">
                  <span className="thread-title">{item.username}</span>
                  <span className="thread-subtitle">Message</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="chat-panel">
          <header className="panel-header">
            <div>
              <h1>{active?.title ?? "Select a chat"}</h1>
              <p>{active?.subtitle ?? "Choose a room or start a direct message"}</p>
            </div>
            <span className={`connection-pill ${connectionState}`}>{connectionState === "connected" ? "Live" : connectionState}</span>
          </header>

          {error && <div className="chat-error">{error}</div>}

          <div className="message-list" ref={scrollRef}>
            {isLoading ? (
              <p className="empty-state">Loading chats...</p>
            ) : !active ? (
              <p className="empty-state">Pick someone from the left and start chatting.</p>
            ) : isLoadingMessages ? (
              <p className="empty-state">Loading messages...</p>
            ) : messages.length === 0 ? (
              <p className="empty-state">No messages yet. Send the first one.</p>
            ) : (
              messages.map((message) => {
                const isMine = message.user.id === user?.id;
                return (
                  <div key={message.id} className={`message-row ${isMine ? "mine" : "theirs"}`}>
                    <div className="message-bubble">
                      {!isMine && <span className="message-author">{message.user.username}</span>}
                      <span className="message-text">{message.content}</span>
                      <span className="message-time">
                        {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form className="composer" onSubmit={handleSend}>
            <input
              value={draft}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
              placeholder={active ? `Message ${active.title}` : "Select a chat first"}
              disabled={!active || connectionState !== "connected"}
              maxLength={2000}
            />
            <button disabled={!active || isSending || !draft.trim() || connectionState !== "connected"}>Send</button>
          </form>
          {sendError && <div className="send-error">{sendError}</div>}
        </section>
      </section>
    </main>
  );
}