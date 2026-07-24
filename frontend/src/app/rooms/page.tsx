"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createRoom, joinRoom, listRooms, type Room } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "@/lib/use-require-auth";

export default function RoomsPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const { token, user, isLoading: authLoading } = useRequireAuth();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    listRooms(token)
      .then((result) => {
        if (!cancelled) setRooms(result.rooms);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Could not load rooms.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRooms(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setActionError(null);
    setIsSubmitting(true);
    try {
      const result = await createRoom(token, newRoomName);
      setNewRoomName("");
      router.push(`/rooms/${result.room.id}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create room.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleJoinRoom(roomId: string) {
    if (!token) return;
    setActionError(null);
    try {
      await joinRoom(token, roomId);
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not join room.");
    }
  }

  if (authLoading || !token) {
    return <main style={styles.page}>Loading…</main>;
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div style={styles.mark}>◆ RELAY</div>
        <div style={styles.headerRight}>
          <span style={styles.username}>{user?.username}</span>
          <button style={styles.logoutButton} onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <section style={styles.content}>
        <h1 style={styles.heading}>Rooms</h1>

        <form onSubmit={handleCreateRoom} style={styles.createForm}>
          <input
            style={styles.input}
            placeholder="New room name (e.g. design-team)"
            value={newRoomName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewRoomName(e.target.value)}
            required
          />
          <button style={styles.createButton} disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create room"}
          </button>
        </form>

        {actionError && <p style={styles.error}>{actionError}</p>}
        {loadError && <p style={styles.error}>{loadError}</p>}

        {isLoadingRooms ? (
          <p style={styles.muted}>Loading rooms…</p>
        ) : rooms.length === 0 ? (
          <p style={styles.muted}>No rooms yet. Create the first one above.</p>
        ) : (
          <ul style={styles.roomList}>
            {rooms.map((room) => (
              <li key={room.id} style={styles.roomItem}>
                <div>
                  <div style={styles.roomName}>#{room.name}</div>
                  <div style={styles.roomMeta}>
                    {room._count.members} member{room._count.members === 1 ? "" : "s"}
                  </div>
                </div>
                <button style={styles.joinButton} onClick={() => handleJoinRoom(room.id)}>
                  Enter
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", flexDirection: "column" },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 28px",
    borderBottom: "1px solid var(--line)",
    background: "#fff",
  },
  mark: { fontFamily: "var(--font-mono)", fontSize: "0.85rem", letterSpacing: "0.12em", color: "var(--signal)" },
  headerRight: { display: "flex", alignItems: "center", gap: "14px" },
  username: { fontSize: "0.9rem", color: "var(--slate)" },
  logoutButton: {
    padding: "7px 14px",
    borderRadius: "8px",
    border: "1px solid var(--line)",
    background: "transparent",
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  content: { maxWidth: "640px", margin: "0 auto", width: "100%", padding: "40px 24px" },
  heading: { fontSize: "1.8rem", margin: "0 0 24px" },
  createForm: { display: "flex", gap: "10px", marginBottom: "20px" },
  input: { flex: 1, padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--line)", background: "#fff" },
  createButton: {
    padding: "10px 18px",
    borderRadius: "8px",
    border: "none",
    background: "var(--signal)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  error: { color: "var(--danger)", fontSize: "0.85rem", background: "#fbeceb", padding: "8px 12px", borderRadius: "8px" },
  muted: { color: "var(--slate)", fontSize: "0.95rem" },
  roomList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" },
  roomItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    background: "#fff",
    border: "1px solid var(--line)",
    borderRadius: "10px",
  },
  roomName: { fontWeight: 600 },
  roomMeta: { fontSize: "0.8rem", color: "var(--slate)", marginTop: "2px" },
  joinButton: {
    padding: "7px 16px",
    borderRadius: "8px",
    border: "1px solid var(--signal)",
    background: "var(--signal-soft)",
    color: "var(--signal)",
    fontWeight: 600,
    cursor: "pointer",
  },
};
