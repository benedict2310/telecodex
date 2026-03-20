FROM node:22-alpine

RUN apk add --no-cache git bash

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

RUN adduser -D -u 1001 telecodex \
  && mkdir -p /workspace /home/telecodex/.codex \
  && chown -R telecodex:telecodex /workspace /home/telecodex

USER telecodex

CMD ["node", "dist/index.js"]
