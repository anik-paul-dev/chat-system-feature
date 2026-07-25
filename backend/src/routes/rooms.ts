import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/require-auth.js";
import { createRoomSchema } from "../lib/validation.js";

export const roomsRouter = Router();

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const MESSAGE_PAGE_SIZE = 50;

// All routes below require a logged-in user.
roomsRouter.use(requireAuth);

// List every room that exists, so a user can discover and join one.
roomsRouter.get("/", async (_req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    });
    res.status(200).json({ rooms });
  } catch (err) {
    console.error("Failed to list rooms:", err);
    res.status(500).json({ error: "Could not load rooms. Please try again.", code: "INTERNAL_ERROR" });
  }
});

// Create a new room. Anyone logged in can create one; the creator is
// automatically joined to it so they don't have to make a second request.
roomsRouter.post("/", async (req, res) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    res.status(400).json({ error: message, code: "VALIDATION_ERROR" });
    return;
  }

  const userId = req.user!.userId;
  const { name } = parsed.data;

  try {
    const room = await prisma.$transaction(async (tx) => {
      const created = await tx.room.create({ data: { name } });
      await tx.roomMember.create({ data: { userId, roomId: created.id } });
      // Re-select with the same shape as GET / (including _count.members)
      // so the client always receives a consistent Room shape, whether it
      // just got this room from the list endpoint or from creating it.
      return tx.room.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { members: true } },
        },
      });
    });
    res.status(201).json({ room });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
      res.status(409).json({ error: "A room with that name already exists.", code: "ROOM_NAME_TAKEN" });
      return;
    }
    console.error("Failed to create room:", err);
    res.status(500).json({ error: "Could not create room. Please try again.", code: "INTERNAL_ERROR" });
  }
});

// Join an existing room. Idempotent by design: joining a room you're
// already in succeeds quietly rather than erroring, since from the
// user's point of view "make sure I'm in this room" isn't really a
// failure if they already were.
roomsRouter.post("/:roomId/join", async (req, res) => {
  const userId = req.user!.userId;
  const { roomId } = req.params;

  try {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      res.status(404).json({ error: `No room found with id "${roomId}".`, code: "ROOM_NOT_FOUND" });
      return;
    }

    await prisma.roomMember.upsert({
      where: { userId_roomId: { userId, roomId } },
      create: { userId, roomId },
      update: {},
    });

    res.status(200).json({ room });
  } catch (err) {
    console.error("Failed to join room:", err);
    res.status(500).json({ error: "Could not join room. Please try again.", code: "INTERNAL_ERROR" });
  }
});

// Fetch recent message history for a room, so a user who just joined (or
// just reconnected) sees the recent conversation instead of a blank
// screen that only fills in from this point forward.
roomsRouter.get("/:roomId/messages", async (req, res) => {
  const { roomId } = req.params;

  try {
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!room) {
      res.status(404).json({ error: `No room found with id "${roomId}".`, code: "ROOM_NOT_FOUND" });
      return;
    }

    const messages = await prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: "desc" },
      take: MESSAGE_PAGE_SIZE,
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    });

    // Reverse so the client receives them oldest-first, ready to render
    // top-to-bottom, without needing to know this was fetched newest-first.
    res.status(200).json({ messages: messages.reverse() });
  } catch (err) {
    console.error("Failed to load message history:", err);
    res.status(500).json({ error: "Could not load messages. Please try again.", code: "INTERNAL_ERROR" });
  }
});