FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY .env.example ./.env.example

ENV NODE_ENV=production

EXPOSE 8788

CMD ["node", "src/server.js"]
