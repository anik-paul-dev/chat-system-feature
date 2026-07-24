import { z } from "zod";

// Kept intentionally strict but simple: usernames that are easy to type,
// display, and safely store, without needing to think about unicode
// edge cases or injection-style concerns in a display name.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(24, "Username must be at most 24 characters.")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores."
  );

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password is too long.");

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
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Room name can only contain letters, numbers, hyphens, and underscores."
  );

export const createRoomSchema = z.object({
  name: roomNameSchema,
});

// Messages are the one place we deliberately do NOT restrict to a strict
// character set, since real chat messages need to allow punctuation,
// emoji, other languages, etc. We do still cap length and strip leading/
// trailing whitespace, and reject empty-after-trim messages (e.g. a
// message that was only spaces).
export const messageContentSchema = z
  .string()
  .trim()
  .min(1, "Message cannot be empty.")
  .max(2000, "Message is too long (max 2000 characters).");

export const sendMessageSchema = z.object({
  roomId: z.string().trim().min(1, "roomId is required."),
  content: messageContentSchema,
});

export const joinRoomSchema = z.object({
  roomId: z.string().trim().min(1, "roomId is required."),
});
