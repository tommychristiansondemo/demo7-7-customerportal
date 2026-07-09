FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json server.ts ./
RUN npx tsc

# Production stage — minimal image
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist/server.js ./server.js

EXPOSE 80

# Run as non-root for security
USER node

CMD ["node", "server.js"]
