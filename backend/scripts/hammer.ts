import "dotenv/config";
import { io as ioClient, type Socket } from "socket.io-client";
import { prisma } from "../src/lib/prisma.js";
import { signToken } from "../src/lib/auth.js";

// Point this at the LOAD BALANCER (nginx), not directly at one backend
// instance — the whole point of this script is to prove that users who
// each get routed to a different one of the two backend instances can
// still see each other's messages, via the Redis adapter. Hitting one
// instance directly would defeat that purpose entirely.
const SERVER_URL = process.env.HAMMER_TARGET_URL ?? "http://localhost:8080";

const MESSAGES_PER_USER = 5;
const CONNECT_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 5_000;

type ConnectedClient = {
  username: string;
  socket: Socket;
};

function connectClient(token: string, username: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(SERVER_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Connection timed out for ${username}`));
    }, CONNECT_TIMEOUT_MS);

    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Connection failed for ${username}: ${err.message}`));
    });
  });
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Ack timed out for event "${event}"`));
    }, ACK_TIMEOUT_MS);

    socket.emit(event, payload, (response: { ok: boolean; error?: string; data?: T }) => {
      clearTimeout(timeout);
      if (!response.ok) {
        reject(new Error(`"${event}" rejected: ${response.error}`));
        return;
      }
      resolve(response.data as T);
    });
  });
}

async function main() {
  console.log(`Hammering ${SERVER_URL} — this should be your load balancer, not a single instance.\n`);

  const users = await prisma.user.findMany({
    select: { id: true, username: true },
    orderBy: { username: "asc" },
    take: 10,
  });

  const room = await prisma.room.findUnique({ where: { name: "general" } });

  if (users.length === 0 || !room) {
    console.error('No seeded users or "general" room found. Run `pnpm seed` first.');
    process.exitCode = 1;
    return;
  }

  console.log(`Connecting ${users.length} users concurrently...`);
  const clients: ConnectedClient[] = [];

  // Track exactly which messages each client actually receives, so we
  // can verify delivery at the end instead of just assuming it worked
  // because nothing threw.
  const receivedByUser = new Map<string, Set<string>>();

  await Promise.all(
    users.map(async (user) => {
      const token = signToken({ userId: user.id, username: user.username });
      const socket = await connectClient(token, user.username);

      const received = new Set<string>();
      receivedByUser.set(user.username, received);
      socket.on("message:new", ({ message }: { message: { id: string } }) => {
        received.add(message.id);
      });

      clients.push({ username: user.username, socket });
    })
  );
  console.log(`All ${clients.length} users connected.\n`);

  console.log("Joining all users to the 'general' room...");
  await Promise.all(
    clients.map((c) => emitWithAck(c.socket, "room:join", { roomId: room.id }))
  );
  console.log("All users joined.\n");

  console.log(
    `Each user sending ${MESSAGES_PER_USER} messages concurrently (${
      clients.length * MESSAGES_PER_USER
    } total)...`
  );

  const sentMessageIds: string[] = [];
  const failures: string[] = [];

  await Promise.all(
    clients.flatMap((c) =>
      Array.from({ length: MESSAGES_PER_USER }, async (_, i) => {
        try {
          const result = await emitWithAck<{ message: { id: string } }>(c.socket, "message:send", {
            roomId: room.id,
            content: `Message ${i + 1} from ${c.username}`,
          });
          sentMessageIds.push(result.message.id);
        } catch (err) {
          failures.push(`${c.username} message ${i + 1}: ${(err as Error).message}`);
        }
      })
    )
  );

  console.log(`Sent: ${sentMessageIds.length} | Failed to send: ${failures.length}`);
  if (failures.length > 0) {
    console.log("First few failures:");
    failures.slice(0, 5).forEach((f) => console.log(`  - ${f}`));
  }

  // Give a short grace period for the last few real-time events to land
  // — this is testing live delivery over the network/Redis, not a
  // synchronous call, so a small buffer avoids a false negative from
  // checking a split second too early.
  await new Promise((r) => setTimeout(r, 1500));

  console.log("\nVerifying every connected user received every sent message...");
  let allDelivered = true;
  for (const [username, received] of receivedByUser) {
    const missing = sentMessageIds.filter((id) => !received.has(id));
    if (missing.length > 0) {
      allDelivered = false;
      console.log(`  ${username}: missing ${missing.length} of ${sentMessageIds.length} messages`);
    }
  }

  if (allDelivered) {
    console.log("PASS: every connected user received every message sent in the room.");
  } else {
    console.log("FAIL: at least one user did not receive all messages — see above.");
    process.exitCode = 1;
  }

  clients.forEach((c) => c.socket.close());
}

main()
  .catch((err) => {
    console.error("Hammer script crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
