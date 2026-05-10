# Think Tank API

## Scripts
- npm run dev: start Fastify with tsx watch
- npm run build: build to dist
- npm run start: run built server

## LLM configuration
Set `apps/api/.env` with one of the following:

- OpenRouter (recommended here):
  - `OPENROUTER_API_KEY=...`
  - Optional: `OPENROUTER_SITE_URL=http://localhost:5173`
  - Optional: `OPENROUTER_APP_NAME=Think Tank`
  - Optional: `OPENAI_MODEL=openai/gpt-4o-mini`
- OpenAI direct:
  - `OPENAI_API_KEY=...`
  - Optional: `OPENAI_MODEL=gpt-4o-mini`

Notes:
- If `OPENROUTER_API_KEY` is set, it is used automatically.
- `OPENAI_BASE_URL` can override the provider endpoint manually.
- If `OPENAI_MODEL` is set to an OpenRouter-style value (for example `openai/gpt-4o-mini`) while using OpenAI direct, the API normalizes it to `gpt-4o-mini`.

## Deployment-critical env
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required for persistent sessions.
- `ALLOW_MEMORY_STORE` controls fallback behavior when Supabase is missing:
  - Development default: `true`
  - Production default: `false`
- `CORS_ORIGIN` can be a single origin or comma-separated list (for example `https://app.example.com,https://staging.example.com`).

## Endpoints
- GET /health
- POST /api/validate-prompt
- GET /api/personas
- POST /api/prompt-preview (requires PROMPT_PREVIEW=true)
- POST /api/sessions/:sessionId/stream
- POST /api/sessions
- GET /api/sessions
- GET /api/sessions/:sessionId
- POST /api/sessions/:sessionId/turns
- GET /api/sessions/:sessionId/turns
- POST /api/sessions/:sessionId/artifacts
- POST /api/sessions/:sessionId/artifacts/upload
- GET /api/sessions/:sessionId/artifacts
- POST /api/sessions/:sessionId/exports (deprecated; use `/exports/generate`)
- POST /api/sessions/:sessionId/exports/generate
- GET /api/sessions/:sessionId/exports
