import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/require-auth.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get("/", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { id: { not: req.user!.userId } },
      orderBy: { username: "asc" },
      select: { id: true, username: true, createdAt: true },
    });
    res.status(200).json({ users });
  } catch (err) {
    console.error("Failed to list users:", err);
    res.status(500).json({ error: "Could not load users. Please try again.", code: "INTERNAL_ERROR" });
  }
});
