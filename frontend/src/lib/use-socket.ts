"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type SocketConnectionState = "connecting" | "connected" | "disconnected" | "error";

/**
 * Owns a single Socket.IO connection for as long as `token` is present,
 * tearing it down and recreating it whenever `token` changes (e.g. after
 * logout then login as a different user), and always cleaning up on
 * unmount so a page navigation never leaves a stray open connection
 * behind.
 */
export function useSocket(token: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<SocketConnectionState>("connecting");

  useEffect(() => {
    if (!token) {
      setState("disconnected");
      return;
    }

    setState("connecting");
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("connect", () => setState("connected"));
    socket.on("disconnect", () => setState("disconnected"));
    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err.message);
      setState("error");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  return { socket: socketRef.current, state };
}
