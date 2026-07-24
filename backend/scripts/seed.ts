import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/auth.js";

const USER_COUNT = 10;
// Every seeded test user shares this password, purely to make manual
// testing and the hammer script simple — never do this in anything
// resembling a real environment.
const SEED_PASSWORD = "password123";

async function main() {
  console.log("Clearing existing data...");
  await prisma.message.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.room.deleteMany();
  await prisma.user.deleteMany();

  console.log("Creating users...");
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const users = await Promise.all(
    Array.from({ length: USER_COUNT }, (_, i) =>
      prisma.user.create({
        data: { username: `user${i + 1}`, passwordHash },
        select: { id: true, username: true },
      })
    )
  );

  console.log("Creating rooms...");
  const roomNames = ["general", "random", "tech-talk"];
  const rooms = await Promise.all(
    roomNames.map((name) => prisma.room.create({ data: { name } }))
  );

  console.log("Joining all seeded users to the 'general' room...");
  const generalRoom = rooms.find((r) => r.name === "general")!;
  await prisma.roomMember.createMany({
    data: users.map((u) => ({ userId: u.id, roomId: generalRoom.id })),
  });

  console.log("\nSeed complete.");
  console.log(`Users (all share password "${SEED_PASSWORD}"):`);
  users.forEach((u) => console.log(`  ${u.username} — ${u.id}`));
  console.log("Rooms:");
  rooms.forEach((r) => console.log(`  ${r.name} — ${r.id}`));
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
