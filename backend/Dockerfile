FROM node:20-alpine

WORKDIR /app

# Install dependencies first, separately from the rest of the source,
# so Docker can cache this layer and skip re-installing on every code
# change — only re-runs when package.json/lockfile actually changes.
COPY package.json ./
RUN npm install

COPY . .

# Generates the Prisma client into node_modules based on schema.prisma —
# must happen after the schema is copied in, and before the app tries to
# import @prisma/client.
RUN npx prisma generate

RUN npm run build

EXPOSE 4000

CMD ["npm", "start"]
