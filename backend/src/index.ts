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

const PORT = Number(process.env.PORT ?? 4000);
// Purely a label for this instance in logs — set differently per Docker
// container (see docker-compose.yml) so you can tell, from the logs
// alone, which of the two backend instances handled a given request or
// delivered a given message. Has no effect on behavior.
const INSTANCE_ID = process.env.INSTANCE_ID ?? "unknown";

const app = express();
app.use(cors());
app.use(express.json());

// Simple liveness check — useful for the nginx load balancer and for
// confirming, from the terminal, which instance answered a request.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", instance: INSTANCE_ID });
});

app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);

// Catch-all for any route that isn't defined above, so a typo'd URL gets
// a clear JSON 404 instead of Express's default HTML error page.
app.use((req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}`, code: "NOT_FOUND" });
});

// Express error handler: anything that throws synchronously inside a
// route handler and isn't already caught lands here, instead of taking
// the whole process down.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled Express error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
  }
);

const httpServer = createServer(app);

const io = new Server<any, any, any, SocketData>(httpServer, {
  cors: { origin: process.env.FRONTEND_ORIGIN ?? "*" },
});

// This is the piece that makes chat work across multiple server
// instances. Without it, `io.to(roomId).emit(...)` only reaches sockets
// connected to THIS process. With the Redis adapter, every instance
// publishes its emits to Redis and subscribes to the same channel, so an
// emit issued on instance A is replayed to instance B's connected
// sockets too — a message from a user on server 1 reaches a user on
// server 2 in the same room, which is exactly the requirement.
io.adapter(createAdapter(pubClient, subClient));

io.use(authenticateSocket);

io.on("connection", (socket) => {
  console.log(`[${INSTANCE_ID}] Socket connected: user=${socket.data.username}`);
  registerSocketHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`[${INSTANCE_ID}] Chat backend listening on port ${PORT}`);
});

// Fail loudly on genuinely unexpected errors rather than limping along in
// an unknown state — but log with full context first, since a silent
// crash is much harder to debug later than a loud one.
process.on("unhandledRejection", (reason) => {
  console.error(`[${INSTANCE_ID}] Unhandled promise rejection:`, reason);
});
process.on("uncaughtException", (err) => {
  console.error(`[${INSTANCE_ID}] Uncaught exception:`, err);
  process.exit(1);
});