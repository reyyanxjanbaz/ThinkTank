# Think Tank

Monorepo layout:
- apps/web: React + Vite + Tailwind
- apps/api: Fastify API
- supabase: Local Supabase config and migrations

## Quick start

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

## Deployment checklist
1. Set all required vars from `apps/api/.env.example` and `apps/web/.env.example`.
2. For production, keep `ALLOW_MEMORY_STORE=false` unless you intentionally want ephemeral in-memory sessions.
3. Set `VITE_API_URL` to your deployed API origin and `CORS_ORIGIN` to your deployed web origin(s).
4. Run `npm run build` from repo root before deploy.
