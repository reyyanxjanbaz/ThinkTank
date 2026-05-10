# Think Tank - Context Summary (10 May 2026)

## Project State
- Workspace scaffolding created with apps/web, apps/api, and supabase folders.
- Supabase local stack installed and running; migrations applied and reset executed.
- Web and API dependencies installed; dev servers started outside sandbox.

## Frontend (apps/web)
- Pixel-art landing + session UI implemented with mode selection, persona selection, session vault, and turn builder.
- Supabase auth wiring with GitHub OAuth (sign in/out) and token-based API calls.
- Streaming response consumption (SSE) and artifact upload UI.
- Export buttons for Markdown and PDF with download handling.
- Tailwind styling for pixel UI, inputs, feed, and selected states.

Key files:
- apps/web/src/App.tsx
- apps/web/src/styles.css
- apps/web/src/lib/api.ts
- apps/web/src/lib/types.ts
- apps/web/src/lib/supabaseClient.ts

## Backend (apps/api)
- Fastify API with session/turn/artifact/export endpoints.
- Persona prompt system + prompt builder.
- Streaming endpoint using OpenAI chat completions.
- Artifact upload and parsing (PDF/text) with async parsing update.
- Export generation endpoint (Markdown/PDF) with Supabase storage upload and signed URLs.
- In-memory store fallback + Supabase store for persistence with auth enforcement.

Key files:
- apps/api/src/server.ts
- apps/api/src/prompts/personas.ts
- apps/api/src/prompts/buildPrompt.ts
- apps/api/src/store/memoryStore.ts
- apps/api/src/store/supabaseStore.ts
- apps/api/src/lib/openai.ts
- apps/api/src/lib/artifactParser.ts
- apps/api/src/lib/exports.ts

## Supabase
- Initial schema migration and RLS/storage policies applied.
- Storage buckets: artifacts, exports (created when permissions allow).

Key files:
- supabase/migrations/2026051001_init.sql
- supabase/migrations/2026051002_rls.sql
- supabase/config.toml

## Environment Files
- apps/web/.env set by user.
- apps/api/.env set by user.
- apps/api/.env.example updated with OpenAI + storage settings.

## Running Services
- Web: http://localhost:5173
- API: http://localhost:3001
- Supabase Studio: http://127.0.0.1:54323

## Known Requirements to Validate
- OPENAI_API_KEY must be set for streaming.
- Supabase GitHub OAuth must be enabled with correct redirect URL.
- Storage policies may be skipped locally if Supabase storage permissions are limited.

## Completed Features (MVP)
- Session creation, persona selection, prompt validation.
- Streaming responses token-by-token.
- Artifact upload and parsing.
- Session replay via Session Vault.
- Export to Markdown and PDF.

## Next Suggested Work
- Public share links (read-only sessions).
- Retention tracking + minimal admin log view.
- UI polish for meeting-room layout and avatar states.
