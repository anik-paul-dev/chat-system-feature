import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { hashPassword, signToken, verifyPassword } from "../lib/auth.js";
import { loginSchema, registerSchema } from "../lib/validation.js";

export const authRouter = Router();

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    res.status(400).json({ error: message, code: "VALIDATION_ERROR" });
    return;
  }

  const { username, password } = parsed.data;

  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, passwordHash },
      select: { id: true, username: true },
    });

    const token = signToken({ userId: user.id, username: user.username });
    res.status(201).json({ token, user });
  } catch (err) {
    // A unique-constraint violation here can only mean the username is
    // already taken — the database is the source of truth for uniqueness,
    // not a separate "check if it exists first" query that could race
    // against a concurrent registration of the same username.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
      res.status(409).json({ error: "That username is already taken.", code: "USERNAME_TAKEN" });
      return;
    }
    console.error("Registration failed:", err);
    res.status(500).json({ error: "Could not create account. Please try again.", code: "INTERNAL_ERROR" });
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    res.status(400).json({ error: message, code: "VALIDATION_ERROR" });
    return;
  }

  const { username, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { username } });

    // Deliberately the same error message and status whether the
    // username doesn't exist or the password is wrong. Distinguishing
    // them would let an attacker use this endpoint to discover which
    // usernames are registered.
    if (!user) {
      res.status(401).json({ error: "Incorrect username or password.", code: "INVALID_CREDENTIALS" });
      return;
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      res.status(401).json({ error: "Incorrect username or password.", code: "INVALID_CREDENTIALS" });
      return;
    }

    const token = signToken({ userId: user.id, username: user.username });
    res.status(200).json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ error: "Could not log in. Please try again.", code: "INTERNAL_ERROR" });
  }
});
