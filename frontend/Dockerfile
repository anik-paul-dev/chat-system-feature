FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Baked in at build time because Next.js inlines NEXT_PUBLIC_* variables
# into the client bundle at build, not at container start — passed in via
# docker-compose's `build.args` / `environment` for this image.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

FROM node:20-alpine

WORKDIR /app

# `output: "standalone"` in next.config.ts produces a minimal server
# bundle here, so the final image only needs these three copied paths
# instead of the full node_modules from the builder stage.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
