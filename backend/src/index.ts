import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { pubClient, subClient } from "./lib/redis.js";
import { authenticateSocket, type SocketData } from "./socket/authenticate.js";
import { registerSocketHandlers } from "./socket/handlers.js";
import { authRouter } from "./routes/auth.js";
import { roomsRouter } from "./routes/rooms.js";
import { usersRouter } from "./routes/users.js";
import { conversationsRouter } from "./routes/conversations.js";

const PORT = Number(process.env.PORT ?? 4000);
const INSTANCE_ID = process.env.INSTANCE_ID ?? "unknown";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", instance: INSTANCE_ID });
});

app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/users", usersRouter);
app.use("/api/conversations", conversationsRouter);

app.use((req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}`, code: "NOT_FOUND" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled Express error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
});

const httpServer = createServer(app);

const io = new Server<any, any, any, SocketData>(httpServer, {
  cors: { origin: process.env.FRONTEND_ORIGIN ?? "*" },
});

io.adapter(createAdapter(pubClient, subClient));
io.use(authenticateSocket);

io.on("connection", (socket) => {
  console.log(`[${INSTANCE_ID}] Socket connected: user=${socket.data.username}`);
  registerSocketHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`[${INSTANCE_ID}] Chat backend listening on port ${PORT}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${INSTANCE_ID}] Unhandled promise rejection:`, reason);
});
process.on("uncaughtException", (err) => {
  console.error(`[${INSTANCE_ID}] Uncaught exception:`, err);
  process.exit(1);
});
