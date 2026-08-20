# Multi-stage build. Repo-root-level (not backend/) since it needs both
# backend/ and frontend/ as sibling build contexts in one image.
#
# node:24-alpine pins the Node major version to match local dev (v24) —
# node:sqlite (backend/db.js's DatabaseSync) is still an experimental,
# version-tied Node built-in, and this repo has no other version pin
# (no .nvmrc). See backend/package.json's "engines" field for the
# documented minimum (>=22.5.0, when node:sqlite shipped).
#
# No native-module build step is needed anywhere (no python3/make/g++) —
# node:sqlite is compiled into the Node binary itself, not an npm package
# like better-sqlite3 would be, so a plain alpine base is sufficient.

# ---- Stage 1: build the frontend (static Vite bundle) ----
FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend runtime ----
FROM node:24-alpine AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
# Lands at the exact relative path server.js's
# join(__dirname, '../frontend/dist') resolves to from /app/backend.
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.js"]
