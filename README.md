# Relay — Multi-Server Chat System

A room-based chat system where users on completely different server
instances can still chat with each other in real time. Two backend
instances run behind an nginx load balancer; a shared Redis makes them
relay messages to each other, and a shared Postgres stores everything
persistently.

## What's inside

- **Frontend** — Next.js + TypeScript. Register/login, a room list, and a
  live chat room page (Socket.IO client).
- **Backend** — Node.js + TypeScript, a standalone Express + Socket.IO
  server (not Next.js's own server — a persistent WebSocket server across
  multiple instances needs its own process). Runs as **two identical
  instances** (`backend-1`, `backend-2`).
- **Postgres** — one instance, shared by both backend instances. Stores
  users, rooms, room memberships, and messages via Prisma.
- **Redis** — one instance, shared by both backend instances. Used for two
  things:
  1. The Socket.IO **Redis adapter** — this is what makes cross-server
     chat actually work. When a message is sent on `backend-1`, it's
     published through Redis; `backend-2` is subscribed to the same
     channel and re-emits it to its own connected users. This is the
     standard, correct way to run Socket.IO across multiple instances.
  2. A shared **rate limiter** — so a user can't dodge the limit just by
     reconnecting and landing on the other instance.
- **nginx** — load balances between `backend-1` and `backend-2` (plain
  round robin, no sticky sessions on purpose), so different users
  genuinely land on different backend instances.

## Requirements

- Docker Desktop (you already have this)
- Nothing else needs to be installed locally — everything runs in containers.

## Step-by-step setup

**1. Copy the environment file:**
```bash
cp .env.example .env
```
Open `.env` and replace the `JWT_SECRET` value with a real random string.
You can generate one with:
```bash
openssl rand -hex 32
```

**2. Build and start everything:**
```bash
docker compose up --build
```
This starts, in order: Postgres, Redis, both backend instances, nginx,
and the frontend. The first run will take a few minutes (installing
dependencies, building images). Leave this running in its own terminal.

**3. Push the database schema** (in a second terminal, once containers are up):
```bash
docker compose exec backend-1 npm run db:push
```

**4. Seed test data:**
```bash
docker compose exec backend-1 npm run seed
```
This creates 10 test users (`user1` … `user10`, all with password
`password123`) and 3 rooms (`general`, `random`, `tech-talk`), with every
seeded user already joined to `general`.

**5. Open the app:**
```
http://localhost:3000
```
Log in as `user1` / `password123` (or register a brand new account), pick
a room, and start chatting.

## How to actually see the multi-server part working

Open two different browsers (or one normal + one incognito window) so you
get two independent sessions:

- Log in as `user1` in one, `user2` in the other.
- Join the same room in both.
- Send a message from one — it should appear instantly in the other.

Behind the scenes, nginx is round-robining connections between
`backend-1` and `backend-2`, so there's a good chance these two sessions
are already talking to two different backend processes. You can confirm
this directly:

```bash
docker compose logs backend-1 backend-2 | grep "Socket connected"
```
You'll see each username logged against whichever instance it actually
connected to.

## Running the stress test (hammer)

The hammer script logs in as all 10 seeded users, connects them all
**through nginx** (not directly to one backend), joins them all to
`general`, has every user send several messages concurrently, and then
verifies that every connected user actually received every message —
proving that cross-instance delivery holds up under concurrent load, not
just in a slow manual test.

```bash
docker compose exec backend-1 npm run hammer
```

Expected output ends with:
```
PASS: every connected user received every message sent in the room.
```

Then check the database state:
```bash
docker compose exec backend-1 npm run verify
```

## Error handling & validation — what's actually enforced

- Every input (register, login, create room, join room, send message) is
  validated with `zod` before touching the database, both on REST routes
  and on Socket.IO events — a malformed socket payload is treated with the
  same care as a malformed HTTP body, not trusted just because it arrived
  over a socket.
- Usernames and room names are checked for uniqueness at the **database**
  level (`@unique` in the Prisma schema), not just "check first, then
  create" application logic, which would be racy under concurrent
  registrations of the same name.
- Passwords are hashed with bcrypt — never stored or logged in plain text.
- JWTs are verified on every socket connection attempt (rejected outright
  if missing/invalid, not allowed to connect and fail later) and on every
  REST request to a protected route.
- Sending a message is rate-limited per user (20 messages / 10 seconds),
  enforced through Redis so it holds true regardless of which backend
  instance the user's socket is connected to.
- A socket claiming to have joined a room isn't trusted on its own —
  sending a message re-checks real room membership in the database before
  the message is persisted or broadcast.
- Every failure path returns a clear `{ error, code }` response with an
  appropriate HTTP status (REST) or `{ ok: false, error, code }`
  acknowledgement (sockets) — nothing fails silently.

## Stopping everything

```bash
docker compose down
```
Add `-v` if you also want to wipe the Postgres data volume and start
completely fresh next time:
```bash
docker compose down -v
```

## Project layout

```
chat-system/
├── docker-compose.yml       # wires together postgres, redis, both backend instances, nginx, frontend
├── nginx/nginx.conf         # load balancer config
├── backend/                 # Node.js + TypeScript + Socket.IO + Prisma
│   ├── src/
│   │   ├── index.ts         # server entrypoint, Socket.IO + Redis adapter setup
│   │   ├── lib/             # prisma client, redis clients, auth, validation, rate limiter
│   │   ├── routes/          # REST routes (auth, rooms)
│   │   └── socket/          # socket auth middleware + event handlers
│   ├── prisma/schema.prisma
│   └── scripts/             # seed.ts, hammer.ts, verify.ts
└── frontend/                 # Next.js + TypeScript
    └── src/app/              # login, register, rooms list, chat room page
```
