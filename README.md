# Think Tank

Monorepo layout:
- apps/web: React + Vite + Tailwind
- apps/api: Fastify API
- supabase: Local Supabase config and migrations

## Quick start

### Run everything (recommended)
1. Install dependencies in both apps (one-time):
   - cd apps/api && npm install
   - cd ../web && npm install
2. From repo root, run:
   - npm run dev

This starts both:
- API on `http://localhost:3001`
- Web on `http://localhost:5173`

If either port is already active, the root dev runner reuses that running service instead of crashing.

Optional:
- `npm run dev:watch` to run API in watch mode as well.

### Web
1. cd apps/web
2. npm install
3. npm run dev

### API
1. cd apps/api
2. npm install
3. npm run dev

### Supabase (local)
1. Install the Supabase CLI if needed
2. supabase start
3. supabase db reset

## Environment files
- apps/web/.env.example
- apps/api/.env.example

## Deployment
See [DEPLOY.md](DEPLOY.md): web on Vercel (`apps/web/vercel.json`), API on Render (`render.yaml`), Supabase migration order, every env var, and a post-deploy smoke checklist.
