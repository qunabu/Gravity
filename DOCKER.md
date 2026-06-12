# Docker

Gravity is a fully static single-page app (TypeScript + Vite). The Docker setup
uses a two-stage build: Node 20 compiles and bundles the source, then nginx serves
the resulting `dist/` directory.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/install/) v2

## Environment variables

Copy `.env.example` to `.env` and fill in any values you need:

```bash
cp .env.example .env
```

The env vars are only required if you want to re-generate the narration MP3s via
`scripts/gen-audio.mjs`. They are not needed to build or run the app — the audio
files are already committed to `public/audio/`.

## Production

Build the image and start the container:

```bash
docker compose up --build
```

The app will be available at <http://localhost:8080>.

To run in the background:

```bash
docker compose up --build -d
docker compose down        # stop and remove
```

### Base path note

`vite.config.ts` sets `base: '/Gravity/'` for production builds so the GitHub
Pages deployment works. The `Dockerfile` overrides this to `base: '/'` (via
`vite build --base=/`) so assets resolve correctly when served from a container
root. If you ever change the nginx location prefix, pass the matching `--base`
flag in the `Dockerfile` build step.

## Development (HMR)

The `dev` service mounts your source directory into a Node container and runs the
Vite HMR dev server. Changes to files in `src/` are reflected in the browser
without rebuilding the image.

```bash
docker compose --profile dev up dev
```

The dev server will be available at <http://localhost:5173>.

`node_modules` are stored in a named Docker volume (`node_modules`) that is
separate from your host `node_modules`. `npm install` runs automatically on
container start, so the first start takes longer.

## Common commands

| Task | Command |
|---|---|
| Build + start production | `docker compose up --build` |
| Start production (pre-built) | `docker compose up` |
| Stop | `docker compose down` |
| Start dev server | `docker compose --profile dev up dev` |
| Rebuild image only | `docker compose build` |
| View logs | `docker compose logs -f` |
| Open shell in running container | `docker compose exec app sh` |

## Image details

| Stage | Base image | Purpose |
|---|---|---|
| `builder` | `node:20-alpine` | Install deps, type-check, Vite bundle |
| `runner` | `nginx:alpine` | Serve static `dist/` on port 80 |
