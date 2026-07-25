import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/require-auth.js";
import { startConversationSchema } from "../lib/validation.js";

export const conversationsRouter = Router();

const MESSAGE_PAGE_SIZE = 50;
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

conversationsRouter.use(requireAuth);

function pairKeyFor(a: string, b: string) {
  return [a, b].sort().join("::");
}

function selectConversationFor() {
  return {
    id: true,
    createdAt: true,
    updatedAt: true,
    members: {
      select: { user: { select: { id: true, username: true } } },
      orderBy: { joinedAt: "asc" as const },
    },
    messages: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    },
  };
}

function shapeConversation(conversation: any, userId: string) {
  const otherUser = conversation.members.map((m: any) => m.user).find((u: any) => u.id !== userId) ?? null;
  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    otherUser,
    lastMessage: conversation.messages[0] ?? null,
  };
}

async function findConversationForResponse(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, members: { some: { userId } } },
    select: selectConversationFor(),
  });
  return conversation ? shapeConversation(conversation, userId) : null;
}

conversationsRouter.get("/", async (req, res) => {
  const userId = req.user!.userId;

  try {
    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      select: selectConversationFor(),
    });

    res.status(200).json({ conversations: conversations.map((conversation) => shapeConversation(conversation, userId)) });
  } catch (err) {
    console.error("Failed to list conversations:", err);
    res.status(500).json({ error: "Could not load direct messages. Please try again.", code: "INTERNAL_ERROR" });
  }
});

conversationsRouter.post("/", async (req, res) => {
  const parsed = startConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(" "), code: "VALIDATION_ERROR" });
    return;
  }

  const userId = req.user!.userId;
  const otherUserId = parsed.data.userId;

  if (userId === otherUserId) {
    res.status(400).json({ error: "You cannot start a direct message with yourself.", code: "SELF_DM_NOT_ALLOWED" });
    return;
  }

  try {
    const otherUser = await prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
    if (!otherUser) {
      res.status(404).json({ error: "That user does not exist.", code: "USER_NOT_FOUND" });
      return;
    }

    const pairKey = pairKeyFor(userId, otherUserId);
    let conversationId: string;

    try {
      const conversation = await prisma.conversation.create({
        data: {
          pairKey,
          members: { create: [{ userId }, { userId: otherUserId }] },
        },
        select: { id: true },
      });
      conversationId = conversation.id;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== UNIQUE_CONSTRAINT_VIOLATION) {
        throw err;
      }
      const conversation = await prisma.conversation.findUnique({ where: { pairKey }, select: { id: true } });
      if (!conversation) throw err;
      conversationId = conversation.id;
    }

    const conversation = await findConversationForResponse(conversationId, userId);
    res.status(200).json({ conversation });
  } catch (err) {
    console.error("Failed to start conversation:", err);
    res.status(500).json({ error: "Could not open direct message. Please try again.", code: "INTERNAL_ERROR" });
  }
});

conversationsRouter.get("/:conversationId/messages", async (req, res) => {
  const userId = req.user!.userId;
  const { conversationId } = req.params;

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: { userId_conversationId: { userId, conversationId } },
      select: { id: true },
    });

    if (!membership) {
      res.status(404).json({ error: "Direct message not found.", code: "CONVERSATION_NOT_FOUND" });
      return;
    }

    const messages = await prisma.directMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: MESSAGE_PAGE_SIZE,
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    });

    res.status(200).json({ messages: messages.reverse() });
  } catch (err) {
    console.error("Failed to load direct message history:", err);
    res.status(500).json({ error: "Could not load direct messages. Please try again.", code: "INTERNAL_ERROR" });
  }
});

