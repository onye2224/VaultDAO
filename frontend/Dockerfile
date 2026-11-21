# ==============================================================================
# VaultDAO Frontend – Multi-stage Dockerfile
# ==============================================================================
# Stages
#   builder  – compiles Vite/TypeScript into static assets
#   dev      – Vite dev-server with hot reload (used by docker-compose.yml)
#   runner   – production Nginx image; SPA fallback + security headers

# ------------------------------------------------------------------------------
# builder: compile static assets
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy lockfile and manifest first for layer-cache efficiency
COPY package.json package-lock.json ./

# Install all deps (devDeps needed for tsc + vite build)
RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

# ------------------------------------------------------------------------------
# dev: Vite dev-server (hot reload)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]

# ------------------------------------------------------------------------------
# runner: production Nginx – SPA fallback + security headers
# ------------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Remove the default site config
RUN rm /etc/nginx/conf.d/default.conf

# Custom config: SPA fallback + security headers
COPY <<'EOF' /etc/nginx/conf.d/vaultdao.conf
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # ── SPA fallback ──────────────────────────────────────────────────────────
    # Serve real files; fall back to index.html for client-side routes.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── Security headers ──────────────────────────────────────────────────────
    add_header X-Frame-Options           "DENY"                            always;
    add_header X-Content-Type-Options    "nosniff"                         always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "geolocation=(), microphone=()"   always;
    add_header Content-Security-Policy
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self'; object-src 'none'; frame-ancestors 'none';"
        always;

    # ── Static asset caching ─────────────────────────────────────────────────
    location ~* \.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        # Security headers must be repeated inside nested location blocks
        add_header X-Frame-Options           "DENY"                            always;
        add_header X-Content-Type-Options    "nosniff"                         always;
        add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    }

    # ── Healthcheck endpoint ──────────────────────────────────────────────────
    location = /healthz {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
EOF

# Copy compiled assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx image default CMD is fine: nginx -g 'daemon off;'
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/healthz || exit 1
