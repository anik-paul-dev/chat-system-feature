import type { Socket } from "socket.io";
import { verifyToken } from "../lib/auth.js";

// Socket.IO's typed data attached to each connected socket, so handlers
// elsewhere can read `socket.data.userId` with type safety instead of a
// cast at every use. Socket.IO's own Socket class already declares a
// `data` property typed via its generic parameters, so instead of
// re-declaring `data` through module augmentation (which conflicts with
// that built-in declaration), we export this type and apply it through
// Socket.IO's generics wherever a typed socket is needed.
export interface SocketData {
  userId: string;
  username: string;
}

export type TypedSocket = Socket<any, any, any, SocketData>;

/**
 * Socket.IO middleware: runs once per connection attempt, before any
 * events are accepted. Expects the client to send its JWT as
 * `socket.handshake.auth.token`. Rejects the connection outright if the
 * token is missing or invalid, rather than allowing an unauthenticated
 * socket to connect and only failing later on individual events.
 */
export function authenticateSocket(socket: TypedSocket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token;

  if (!token || typeof token !== "string") {
    next(new Error("UNAUTHENTICATED"));
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    next(new Error("INVALID_TOKEN"));
    return;
  }

  socket.data.userId = payload.userId;
  socket.data.username = payload.username;
  next();
}