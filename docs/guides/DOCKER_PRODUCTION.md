# Docker Production Deployment

This guide covers running the production Docker images for VaultDAO.

## Prerequisites

- Docker ≥ 24 and Docker Compose v2
- A populated `backend/.env` (see `backend/.env.example`)

## Starting the production stack

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The override file `docker-compose.prod.yml` changes both services to their
compiled `runner` targets:

| Service  | Base image        | What runs                                   |
|----------|-------------------|---------------------------------------------|
| backend  | `node:22-alpine`  | `node dist/index.js` (compiled TypeScript)  |
| frontend | `nginx:1.27-alpine` | Static assets behind Nginx on port 80     |

Host port mapping in production:

| Service  | Container port | Host port |
|----------|----------------|-----------|
| backend  | 8787           | 8787      |
| frontend | 80             | 8080      |

## Smoke test

After the stack is healthy, run:

```bash
bash scripts/smoke-test.sh
```

This script:
1. Builds and starts the production compose stack
2. Waits for both services to report `healthy`
3. Checks `GET /health` on the backend
4. Checks all required security headers on the frontend
5. Verifies SPA fallback for a deep client-side route
6. Tears down the stack

## Security headers

The frontend Nginx image sets these response headers on every request:

| Header                    | Value                                    |
|---------------------------|------------------------------------------|
| `X-Frame-Options`         | `DENY`                                   |
| `X-Content-Type-Options`  | `nosniff`                                |
| `Referrer-Policy`         | `strict-origin-when-cross-origin`        |
| `Permissions-Policy`      | `geolocation=(), microphone=()`          |
| `Content-Security-Policy` | `default-src 'self'; …` (see Dockerfile) |

Run the header regression check in isolation:

```bash
# Against a running container or deployed instance
bash scripts/check-headers.sh https://your-deployed-url.example.com
```

The same check runs automatically in CI as the **Frontend Docker Image – Security Headers** job.

## SPA fallback

The Nginx config uses `try_files $uri $uri/ /index.html` so React Router
deep-links serve `index.html` rather than a 404.

## Non-root users

Both runner images run as the `node` user (UID 1000). The backend Dockerfile
pre-creates `/app` owned by `node:node` before switching users.

## Lockfile policy

The backend and frontend both use `package-lock.json` (npm). No `pnpm-lock.yaml`
is copied into any Docker image. The `.dockerignore` files exclude any stray
`pnpm-lock.yaml` from the build context.
