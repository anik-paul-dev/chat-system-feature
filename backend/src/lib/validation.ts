import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(24, "Username must be at most 24 characters.")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores.");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters.").max(200, "Password is too long.");

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});

export const roomNameSchema = z
  .string()
  .trim()
  .min(2, "Room name must be at least 2 characters.")
  .max(40, "Room name must be at most 40 characters.")
  .regex(/^[a-zA-Z0-9_-]+$/, "Room name can only contain letters, numbers, hyphens, and underscores.");

export const createRoomSchema = z.object({
  name: roomNameSchema,
});

export const messageContentSchema = z
  .string()
  .trim()
  .min(1, "Message cannot be empty.")
  .max(2000, "Message is too long (max 2000 characters).");

export const idSchema = z.string().trim().min(1, "id is required.");

export const sendMessageSchema = z
  .object({
    roomId: z.string().trim().min(1, "roomId is required.").optional(),
    conversationId: z.string().trim().min(1, "conversationId is required.").optional(),
    content: messageContentSchema,
  })
  .refine((value) => Boolean(value.roomId) !== Boolean(value.conversationId), {
    message: "Send either roomId or conversationId, but not both.",
  });

export const joinRoomSchema = z.object({
  roomId: z.string().trim().min(1, "roomId is required."),
});

export const conversationIdSchema = z.object({
  conversationId: z.string().trim().min(1, "conversationId is required."),
});

export const startConversationSchema = z.object({
  userId: z.string().trim().min(1, "userId is required."),
});
