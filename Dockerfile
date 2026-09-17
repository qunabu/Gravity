# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# vite.config.ts hardcodes base="/Gravity/" for GitHub Pages builds.
# Override to "/" so assets resolve correctly when served from a container root.
RUN npx tsc && npx vite build --base=/

# ── Production stage ──────────────────────────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
