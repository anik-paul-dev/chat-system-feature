"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyRoomPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/rooms");
  }, [router]);

  return <main className="chat-loading">Opening chat...</main>;
}
