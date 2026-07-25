import type { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma.js";
import { hit } from "../lib/rate-limit.js";
import { conversationIdSchema, joinRoomSchema, sendMessageSchema } from "../lib/validation.js";
import type { SocketData } from "./authenticate.js";

const MESSAGE_RATE_LIMIT = 20;
const MESSAGE_RATE_WINDOW_SECONDS = 10;

type AckCallback = (response: { ok: boolean; error?: string; code?: string; data?: unknown }) => void;

function safeAck(ack: AckCallback | undefined, response: Parameters<AckCallback>[0]) {
  if (typeof ack === "function") ack(response);
}

function dmSocketRoom(conversationId: string) {
  return `dm:${conversationId}`;
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
        safeAck(ack, { ok: false, error: parsed.error.issues.map((i) => i.message).join(" "), code: "VALIDATION_ERROR" });
        return;
      }

      const { roomId } = parsed.data;
      const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, name: true } });
      if (!room) {
        safeAck(ack, { ok: false, error: `No room found with id "${roomId}".`, code: "ROOM_NOT_FOUND" });
        return;
      }

      await prisma.roomMember.upsert({
        where: { userId_roomId: { userId, roomId } },
        create: { userId, roomId },
        update: {},
      });

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

  socket.on("conversation:join", async (payload: unknown, ack?: AckCallback) => {
    try {
      const parsed = conversationIdSchema.safeParse(payload);
      if (!parsed.success) {
        safeAck(ack, { ok: false, error: parsed.error.issues.map((i) => i.message).join(" "), code: "VALIDATION_ERROR" });
        return;
      }

      const { conversationId } = parsed.data;
      const membership = await prisma.conversationMember.findUnique({
        where: { userId_conversationId: { userId, conversationId } },
        select: { id: true },
      });

      if (!membership) {
        safeAck(ack, { ok: false, error: "Direct message not found.", code: "CONVERSATION_NOT_FOUND" });
        return;
      }

      await socket.join(dmSocketRoom(conversationId));
      safeAck(ack, { ok: true });
    } catch (err) {
      console.error(`conversation:join failed for user ${userId}:`, err);
      safeAck(ack, { ok: false, error: "Could not open direct message.", code: "INTERNAL_ERROR" });
    }
  });

  socket.on("conversation:leave", async (payload: unknown, ack?: AckCallback) => {
    try {
      const parsed = conversationIdSchema.safeParse(payload);
      if (!parsed.success) {
        safeAck(ack, { ok: false, error: "conversationId is required.", code: "VALIDATION_ERROR" });
        return;
      }
      await socket.leave(dmSocketRoom(parsed.data.conversationId));
      safeAck(ack, { ok: true });
    } catch (err) {
      console.error(`conversation:leave failed for user ${userId}:`, err);
      safeAck(ack, { ok: false, error: "Could not leave direct message.", code: "INTERNAL_ERROR" });
    }
  });

  socket.on("message:send", async (payload: unknown, ack?: AckCallback) => {
    try {
      const parsed = sendMessageSchema.safeParse(payload);
      if (!parsed.success) {
        safeAck(ack, { ok: false, error: parsed.error.issues.map((i) => i.message).join(" "), code: "VALIDATION_ERROR" });
        return;
      }

      const { roomId, conversationId, content } = parsed.data;
      const rateLimitResult = await hit(`chat-message:${userId}`, MESSAGE_RATE_LIMIT, MESSAGE_RATE_WINDOW_SECONDS);
      if (!rateLimitResult.allowed) {
        safeAck(ack, {
          ok: false,
          error: "You're sending messages too quickly. Please slow down.",
          code: "RATE_LIMITED",
          data: { retryAfterSeconds: rateLimitResult.retryAfterSeconds },
        });
        return;
      }

      if (roomId) {
        const membership = await prisma.roomMember.findUnique({
          where: { userId_roomId: { userId, roomId } },
          select: { id: true },
        });
        if (!membership) {
          safeAck(ack, { ok: false, error: "You must join this room before sending messages to it.", code: "NOT_A_MEMBER" });
          return;
        }

        const message = await prisma.message.create({
          data: { content, userId, roomId },
          select: { id: true, content: true, createdAt: true, user: { select: { id: true, username: true } } },
        });

        io.to(roomId).emit("message:new", { targetType: "room", roomId, message });
        safeAck(ack, { ok: true, data: { message } });
        return;
      }

      const membership = await prisma.conversationMember.findUnique({
        where: { userId_conversationId: { userId, conversationId: conversationId! } },
        select: { id: true },
      });
      if (!membership) {
        safeAck(ack, { ok: false, error: "You are not a member of this direct message.", code: "NOT_A_MEMBER" });
        return;
      }

      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.directMessage.create({
          data: { content, userId, conversationId: conversationId! },
          select: { id: true, content: true, createdAt: true, user: { select: { id: true, username: true } } },
        });
        await tx.conversation.update({ where: { id: conversationId! }, data: { updatedAt: new Date() } });
        return created;
      });

      io.to(dmSocketRoom(conversationId!)).emit("message:new", { targetType: "conversation", conversationId, message });
      safeAck(ack, { ok: true, data: { message } });
    } catch (err) {
      console.error(`message:send failed for user ${userId}:`, err);
      safeAck(ack, { ok: false, error: "Could not send message. Please try again.", code: "INTERNAL_ERROR" });
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: user=${username} reason=${reason}`);
  });
}

