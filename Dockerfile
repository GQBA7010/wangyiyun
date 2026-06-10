# ---- Build the frontend ----------------------------------------------------
FROM node:20-bookworm-slim AS web-build
WORKDIR /build
COPY web/package*.json web/
RUN npm --prefix web ci
COPY web web
# vite outputs to ../server/public
COPY server/package.json server/
RUN npm --prefix web run build

# ---- Build the backend -----------------------------------------------------
FROM node:20-bookworm-slim AS server-build
# Toolchain for better-sqlite3's native module.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY server/package*.json server/
RUN npm --prefix server ci
COPY server server
RUN npm --prefix server run build && npm --prefix server prune --omit=dev

# ---- Runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY server/package*.json ./
COPY --from=server-build /build/server/node_modules ./node_modules
COPY --from=server-build /build/server/dist ./dist
COPY --from=web-build /build/server/public ./public

# Persist SQLite data outside the container.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
