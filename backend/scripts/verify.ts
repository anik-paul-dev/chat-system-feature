import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const [userCount, roomCount, messageCount, membershipCount, conversationCount, directMessageCount] = await Promise.all([
    prisma.user.count(),
    prisma.room.count(),
    prisma.message.count(),
    prisma.roomMember.count(),
    prisma.conversation.count(),
    prisma.directMessage.count(),
  ]);

  console.log(
    `Users: ${userCount} | Rooms: ${roomCount} | Room memberships: ${membershipCount} | Room messages: ${messageCount} | DMs: ${conversationCount} | DM messages: ${directMessageCount}`
  );

  const messagesPerRoom = await prisma.message.groupBy({
    by: ["roomId"],
    _count: { id: true },
  });

  if (messagesPerRoom.length > 0) {
    console.log("\nMessages per room:");
    for (const row of messagesPerRoom) {
      const room = await prisma.room.findUnique({ where: { id: row.roomId }, select: { name: true } });
      console.log(`  ${room?.name ?? row.roomId}: ${row._count.id}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Verify failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
