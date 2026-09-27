# Deploying Think Tank

## Target

| Part | Host | Why |
|---|---|---|
| Web (`apps/web`) | **Vercel**, static Vite build | The web app is a static SPA with hash routes. Vercel serves it from a CDN, and `apps/web/vercel.json` sets the caching headers. |
| API (`apps/api`) | **Render** web service (Node), defined in `render.yaml` | The API is a long-running Fastify server. It streams LLM tokens over SSE for up to a minute and parses uploads in the background. Serverless function timeouts and buffering don't suit that. Render runs a persistent Node process and passes streams through unbuffered. |
| Database, auth, storage | **Supabase** (hosted project) | Already used by both apps. |

Any other host that runs a persistent Node 22+ process (Supabase needs its built-in WebSocket) also works for the API (Fly.io, Railway, a VM). Use the same build and start commands and the same env vars.

## 1. Supabase

1. Create a Supabase project, or use your existing one.
2. Apply the migrations **in this order**. They are idempotent, so re-running them is safe:
   1. `supabase/migrations/2026051001_init.sql`: tables, enums and indexes (profiles, sessions, turns, artifacts, exports, retention_events).
   2. `supabase/migrations/2026051002_rls.sql`: row-level security policies, plus the `artifacts` and `exports` storage buckets and their object policies.
   3. `supabase/migrations/2026092701_session_summaries.sql`: the `session_summaries(p_user_id)` RPC used by the council list. Only the service role may execute it. Until it exists, the API falls back to counting from embedded turns and logs a warning once.

   Apply them with the CLI (`supabase link --project-ref <ref>` then `supabase db push`), or paste each file into the SQL editor in the order above.
3. Check that the storage buckets `artifacts` and `exports` exist and are **private**.
4. Go to Auth → URL Configuration. Set the **Site URL** to the Vercel production URL, and add it (plus any preview URLs you use) to **Redirect URLs**.
5. Collect these values: the project URL, the **anon** key (for web) and the **service-role** key (for the API only).

## 2. API on Render

1. Push the repo to GitHub.
2. In Render, go to **New → Blueprint** and pick the repo. Render reads `render.yaml`, which sets:
   - Root dir: `apps/api`
   - Build: `npm ci --include=dev && npm run build` (the TypeScript is compiled to `dist/`)
   - Start: `npm run start` (`node dist/server.js`)
   - Health check: `/health`
3. Fill in the variables marked `sync: false` (see the table below). At minimum set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`) and `CORS_ORIGIN`.
   - The Vercel URL isn't known until step 3. Set `CORS_ORIGIN` to the planned Vercel domain now, or deploy the web first and come back.
4. Deploy. The API refuses to start in production when a required variable is missing or invalid. It prints one list of every problem, so read the Render logs if the deploy fails.
5. Note the service URL, for example `https://thinktank-api.onrender.com`.

Pick a paid instance or keep one warm: free Render instances sleep, and the first request after a sleep takes about 30 s.

Manual alternative (any Node host):
```bash
cd apps/api
npm ci --include=dev
npm run build
NODE_ENV=production PORT=8080 npm run start
```

## 3. Web on Vercel

1. In Vercel, go to **Add New → Project**, import the repo and set **Root Directory = `apps/web`**. `apps/web/vercel.json` supplies the framework (`vite`), the install and build commands, the output directory (`dist`) and the headers.
2. Set the environment variables for Production (and Preview if you use it):
   - `VITE_API_URL`: the Render URL from step 2, with no trailing slash.
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   - `VITE_AUTH_REDIRECT_URL`: the Vercel production URL. Optional, because it defaults to the page origin.
3. Deploy. `VITE_*` values are baked in at build time, so **redeploy after changing any of them**.
4. Put the final Vercel origin into the API's `CORS_ORIGIN` and `OPENROUTER_SITE_URL`. Render redeploys automatically when you save the variables.

Routing: the app uses hash routes (`#/`, `#/app`), so every URL is served by `index.html` and no rewrite rules are needed.

Caching (from `vercel.json`):
- `/assets/*` is content-hashed, so it is cached for a year as `immutable`.
- `index.html`, `sw.js` and `manifest.webmanifest` are `no-cache`, so a new deploy is picked up immediately.

## Environment variables

### API (`apps/api`, set on Render)

| Variable | Required | Default | What it is |
|---|---|---|---|
| `NODE_ENV` | yes | `development` | Set to `production`. This turns on the strict startup checks and the production defaults. |
| `PORT` | no | `3001` | Port to listen on. Render injects it. |
| `HOST` | no | `0.0.0.0` | Interface to bind to. |
| `LOG_LEVEL` | no | `info` | Pino log level: `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `TRUST_PROXY` | recommended | `false` | Set to `true` (or a hop count) behind Render, Fly or Railway, so rate limits key on the real client IP. |
| `CORS_ORIGIN` | **yes (prod)** | none | Comma-separated web origins with no trailing slash, e.g. `https://thinktank.vercel.app`. `*` is rejected in production. |
| `SUPABASE_URL` | **yes (prod)** | none | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes (prod)** | none | Service-role key. It stays on the server and must never be put in a `VITE_*` variable. |
| `SUPABASE_STORAGE_BUCKET` | no | `artifacts` | Bucket for uploaded files. |
| `SUPABASE_EXPORT_BUCKET` | no | `exports` | Bucket for exported minutes (MD/PDF). |
| `ALLOW_MEMORY_STORE` | no | `false` in prod | `true` runs without Supabase and keeps sessions in memory, which is lost on restart. Use it for demos only. |
| `OPENROUTER_API_KEY` | **one of these two (prod)** | none | OpenRouter key. It takes precedence when set. |
| `OPENAI_API_KEY` | **one of these two (prod)** | none | OpenAI key, used when no OpenRouter key is set. |
| `OPENAI_BASE_URL` | no | provider default | Overrides the provider endpoint. |
| `OPENAI_MODEL` | no | `openai/gpt-4o-mini` (OpenRouter), `gpt-4o-mini` (OpenAI) | Model id. |
| `OPENAI_TEMPERATURE` | no | `0.7` | Sampling temperature (0–2). |
| `OPENROUTER_SITE_URL` | no | none | Referer sent to OpenRouter. Use the web origin. |
| `OPENROUTER_APP_NAME` | no | `Think Tank` | App name sent to OpenRouter. |
| `MAX_ARTIFACT_SIZE` | no | `5242880` | Maximum upload size in bytes. |
| `RATE_LIMIT_MAX` | no | `30` | LLM requests per client IP per minute, counted per endpoint (the two streams and titles). |
| `PROMPT_PREVIEW` | no | `false` | Enables the debug endpoint `POST /api/prompt-preview`. Keep it `false`. |

### Web (`apps/web`, set on Vercel, public and baked in at build time)

| Variable | Required | What it is |
|---|---|---|
| `VITE_API_URL` | **yes** | API origin, e.g. `https://thinktank-api.onrender.com`. A production build never falls back to localhost. If this is empty, the build warns and the app calls its own origin. |
| `VITE_SUPABASE_URL` | yes, for sign-in | Supabase project URL. If this and the anon key are both empty, the app runs in local mode without accounts. |
| `VITE_SUPABASE_ANON_KEY` | yes, for sign-in | The public **anon** key, never the service-role key. |
| `VITE_AUTH_REDIRECT_URL` | no | Where auth emails send users back to. Defaults to the page origin. |
| `VITE_ENABLE_SW` | no | Development only: `true` serves the service worker under `vite dev`. |

## Post-deploy smoke checklist

Run these against production (replace the URLs):

- [ ] `curl https://<api>/health` returns `status: "ok"`, `persistence: "supabase"` and `llmConfigured: true`.
- [ ] `curl -H "Origin: https://<web>" -I https://<api>/api/personas` includes `access-control-allow-origin: https://<web>`.
- [ ] `curl -H "Origin: https://evil.example" -I https://<api>/api/personas` has **no** `access-control-allow-origin` header.
- [ ] Open `https://<web>/` and check that the landing page, favicon and title "Think Tank" load, with no console errors and no requests to `localhost`.
- [ ] Sign up or sign in, and check that the confirmation email returns you to the Vercel URL.
- [ ] Start a council and ask a question. Tokens should stream in gradually rather than all at once. If they arrive all at once, something between the browser and the API is buffering.
- [ ] Reload the page. The council shows in the sidebar with its reply count, which confirms the `session_summaries` RPC. If the Render logs show `session_summaries unavailable`, migration 3 was not applied.
- [ ] Rename the council, then delete it.
- [ ] Upload a small PDF or TXT and wait until its status reaches `ready`.
- [ ] Export the minutes as MD and as PDF, and check that the download links work.
- [ ] Redeploy the web and check that the "new version" reload prompt appears and the page picks up the new build.
- [ ] Check the Render logs: JSON lines at `info` level, and no stack traces returned to clients.

## Operational notes

- **Shutdown:** on SIGTERM the API stops accepting connections and waits up to 10 s for in-flight requests before it exits.
- **Error responses:** errors of 500 and above return `{ "error": "server_error" }`. Details are logged, not sent to the client.
- **Body limits:** JSON bodies are capped at 1 MiB. Uploads are capped at one file of `MAX_ARTIFACT_SIZE`.
- **Rate limits:** the rate limit is in-memory, per instance. If you scale beyond one instance, move it to a shared store (`@fastify/rate-limit` supports Redis).
- **Rollback:** use Vercel "Instant Rollback" for the web and Render "Rollback" to a previous deploy for the API. The migrations are additive.
