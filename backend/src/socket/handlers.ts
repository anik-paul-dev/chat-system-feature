import type { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma.js";
import { hit } from "../lib/rate-limit.js";
import { joinRoomSchema, sendMessageSchema } from "../lib/validation.js";
import type { SocketData } from "./authenticate.js";

// A user can send at most this many messages per window. Generous enough
// for genuine fast typing/back-and-forth conversation, tight enough to
// stop a scripted flood from one connection.
const MESSAGE_RATE_LIMIT = 20;
const MESSAGE_RATE_WINDOW_SECONDS = 10;

// Every event payload the client sends is untrusted input, exactly like
// an HTTP request body — validated the same way, with the same care,
// even though it's arriving over a socket instead of a POST request.
type AckCallback = (response: { ok: boolean; error?: string; code?: string; data?: unknown }) => void;

function safeAck(ack: AckCallback | undefined, response: Parameters<AckCallback>[0]) {
  // The client is expected to pass an acknowledgement callback on every
  // emit, but a malformed or outdated client might not. Guarding this
  // means a missing callback never crashes the server — it just means
  // that particular client doesn't get a direct response, which is a
  // client-side problem, not a reason to bring the connection down.
  if (typeof ack === "function") {
    ack(response);
  }
}

export function registerSocketHandlers(
  io: Server<any, any, any, SocketData>,
  socket: Socket<any, any, any, SocketData>
) {
  const { userId, username } = socket.data;

  socket.on("room:join", async (payload: unknown, ack?: AckCallback) => {
    try {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) {
        safeAck(ack, {
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join(" "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { roomId } = parsed.data;

      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, name: true } });
      if (!room) {
        safeAck(ack, { ok: false, error: `No room found with id "${roomId}".`, code: "ROOM_NOT_FOUND" });
        return;
      }

      // Ensure a persisted membership exists, same as the REST join
      // endpoint — a socket-only join still counts as joining the room.
      await prisma.roomMember.upsert({
        where: { userId_roomId: { userId, roomId } },
        create: { userId, roomId },
        update: {},
      });

      // Socket.IO's own "room" concept, scoped to this specific socket
      // connection — this is what makes `io.to(roomId).emit(...)` reach
      // only sockets that joined it, on THIS instance. The Redis adapter
      // (configured in index.ts) is what makes that same `emit` also
      // reach sockets connected to the OTHER server instance.
      await socket.join(roomId);

      socket.to(roomId).emit("room:user-joined", { roomId, username });

      safeAck(ack, { ok: true, data: { room } });
    } catch (err) {
      console.error(`room:join failed for user ${userId}:`, err);
      safeAck(ack, { ok: false, error: "Could not join room. Please try again.", code: "INTERNAL_ERROR" });
    }
  });

  socket.on("room:leave", async (payload: unknown, ack?: AckCallback) => {
    try {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) {
        safeAck(ack, { ok: false, error: "roomId is required.", code: "VALIDATION_ERROR" });
        return;
      }

      const { roomId } = parsed.data;
      await socket.leave(roomId);
      socket.to(roomId).emit("room:user-left", { roomId, username });
      safeAck(ack, { ok: true });
    } catch (err) {
      console.error(`room:leave failed for user ${userId}:`, err);
      safeAck(ack, { ok: false, error: "Could not leave room.", code: "INTERNAL_ERROR" });
    }
  });

  socket.on("message:send", async (payload: unknown, ack?: AckCallback) => {
    try {
      const parsed = sendMessageSchema.safeParse(payload);
      if (!parsed.success) {
        safeAck(ack, {
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join(" "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { roomId, content } = parsed.data;

      // Rate limit BEFORE any database work, same principle as the
      // booking endpoint: fail cheap, don't let abusive traffic reach
      // Postgres. Keyed on userId (shared via Redis) so it holds
      // regardless of which of the two server instances this socket
      // happens to be connected to.
      const rateLimitResult = await hit(
        `chat-message:${userId}`,
        MESSAGE_RATE_LIMIT,
        MESSAGE_RATE_WINDOW_SECONDS
      );
      if (!rateLimitResult.allowed) {
        safeAck(ack, {
          ok: false,
          error: "You're sending messages too quickly. Please slow down.",
          code: "RATE_LIMITED",
          data: { retryAfterSeconds: rateLimitResult.retryAfterSeconds },
        });
        return;
      }

      // A socket claiming to have joined a room isn't proof enough on
      // its own — confirm real membership in the database before
      // accepting the message, so a client can't fabricate a `roomId` it
      // never legitimately joined and have the message persist anyway.
      const membership = await prisma.roomMember.findUnique({
        where: { userId_roomId: { userId, roomId } },
        select: { id: true },
      });
      if (!membership) {
        safeAck(ack, {
          ok: false,
          error: "You must join this room before sending messages to it.",
          code: "NOT_A_MEMBER",
        });
        return;
      }

      const message = await prisma.message.create({
        data: { content, userId, roomId },
        select: {
          id: true,
          content: true,
          createdAt: true,
          user: { select: { id: true, username: true } },
        },
      });

      // `io.to(roomId)` (not `socket.to(roomId)`) so the sender's OWN
      // other connections/tabs also receive it, and — critically for
      // this project's actual requirement — so a user connected to the
      // OTHER server instance in the same room receives it too, via the
      // Redis adapter relaying this emit across instances.
      io.to(roomId).emit("message:new", { roomId, message });

      safeAck(ack, { ok: true, data: { message } });
    } catch (err) {
      console.error(`message:send failed for user ${userId}:`, err);
      safeAck(ack, { ok: false, error: "Could not send message. Please try again.", code: "INTERNAL_ERROR" });
    }
  });

  socket.on("disconnect", (reason) => {
    // Purely informational — no cleanup needed here beyond what
    // Socket.IO already does automatically (it removes the socket from
    // all rooms it had joined on disconnect).
    console.log(`Socket disconnected: user=${username} reason=${reason}`);
  });
}