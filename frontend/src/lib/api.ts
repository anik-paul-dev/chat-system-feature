// All REST calls to the backend go through here, so there's exactly one
// place that knows the backend's base URL and exactly one place that
// shapes how errors from the backend get turned into JS Errors the rest
// of the app can catch and display.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<T> {
  const { method = "GET", body, token } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // A network-level failure (server unreachable, DNS, CORS, etc) never
    // reaches the JSON-parsing code below — catch it here with a message
    // a real person can actually act on.
    throw new ApiError("Could not reach the server. Check your connection and try again.", "NETWORK_ERROR", 0);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("The server sent an unexpected response.", "BAD_RESPONSE", response.status);
  }

  if (!response.ok) {
    const parsed = data as { error?: string; code?: string };
    throw new ApiError(parsed.error ?? "Something went wrong.", parsed.code ?? "UNKNOWN_ERROR", response.status);
  }

  return data as T;
}

export type AuthResponse = { token: string; user: { id: string; username: string } };

export function registerUser(username: string, password: string) {
  return request<AuthResponse>("/api/auth/register", { method: "POST", body: { username, password } });
}

export function loginUser(username: string, password: string) {
  return request<AuthResponse>("/api/auth/login", { method: "POST", body: { username, password } });
}

export type Room = { id: string; name: string; createdAt: string; _count: { members: number } };

export function listRooms(token: string) {
  return request<{ rooms: Room[] }>("/api/rooms", { token });
}

export function createRoom(token: string, name: string) {
  return request<{ room: Room }>("/api/rooms", { method: "POST", body: { name }, token });
}

export function joinRoom(token: string, roomId: string) {
  return request<{ room: Room }>(`/api/rooms/${roomId}/join`, { method: "POST", token });
}

export type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; username: string };
};

export function fetchMessageHistory(token: string, roomId: string) {
  return request<{ messages: ChatMessage[] }>(`/api/rooms/${roomId}/messages`, { token });
}
