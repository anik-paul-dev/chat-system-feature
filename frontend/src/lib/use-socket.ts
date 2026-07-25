"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type SocketConnectionState = "connecting" | "connected" | "disconnected" | "error";

export function useSocket(token: string | null) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<SocketConnectionState>("connecting");

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setState("disconnected");
      return;
    }

    setState("connecting");
    const nextSocket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket"],
    });

    setSocket(nextSocket);
    nextSocket.on("connect", () => setState("connected"));
    nextSocket.on("disconnect", () => setState("disconnected"));
    nextSocket.on("connect_error", (err) => {
      console.error("Socket connection error:", err.message);
      setState("error");
    });

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [token]);

  return { socket, state };
}
