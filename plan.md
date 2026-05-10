# AI Council (Think Tank) - Master Plan

## 1. Product intent
- Vision: a room full of minds on demand, not a chat app.
- Emotional target: immersive, strategic, retro-futuristic, playful, high-stakes.
- Primary outcome: structured cognitive conflict that generates better ideas.

## 2. MVP scope (locked)
- Web app, desktop-first, logged-in.
- Five personas: Devil, Tyson, Bison, Anshu, Bucks.
- User selects 1-2 persona responses per turn (sequential).
- Streaming responses token-by-token.
- Persistent, replayable sessions.
- Artifact uploads with async parsing (5MB initially, 15MB later).
- Export to Markdown and PDF.
- Public sharing (basic, moderation TBD later).
- Input validation with Zod + regex blocklist.

## 3. Non-goals for MVP
- Multiplayer human sessions.
- Voice input/output.
- Advanced analytics beyond retention.
- Persona marketplace.
- Fully automated persona cross-talk without user prompts.

## 4. Success criteria (MVP)
- Users can start a council in < 30 seconds end-to-end.
- Response streaming starts in under 3 seconds after persona selection.
- Sessions persist and replay with exact responses.
- Artifact parsing completes within 2-3 seconds for most 5MB PDFs.
- Export works for all sessions without data loss.
- Retention tracking implemented and visible in admin logs.

## 5. Guiding product principles
- The room feels alive: motion, light, idle states, and speaking cues.
- Language reinforces the fantasy: initialize council, enter arena, etc.
- Personas are distinct in thought, tone, and strategic bias.
- Structured conflict is intentional and transparent to the user.

## 6. Architecture overview
- Frontend: React 18 + TypeScript + Tailwind + TanStack Query.
- Backend: Node.js 20 + Fastify + TypeScript.
- Auth, DB, Storage, Realtime: Supabase.
- Queue: Bull + Redis for LLM and parsing jobs.
- LLM: OpenAI GPT-3.5-Turbo via streaming.
- Real-time: Socket.io or native WebSocket.

## 7. Core modules and responsibilities

### 7.1 Frontend
- Session creation UI: start council, select mode, invite personas.
- Meeting room UI: persona frames, speaking indicators, debate log.
- Token streaming renderer: typewriter, backlog handling, reconnection.
- Artifact upload UI: status, parsing progress, ready signal.
- Session management: list, open, replay, export.
- Auth flows: OAuth with Supabase.

### 7.2 Backend
- Session API: CRUD, replay, export.
- LLM orchestrator: persona prompts, turn logic, streaming.
- Input validation: Zod + blocklist.
- Artifact pipeline: upload, store, enqueue parse, notify ready.
- Queue workers: LLM jobs and parsing jobs.
- Cache layer: response caching for failure fallback.

### 7.3 Data stores (Supabase)
- Users, profiles, sessions, turns, artifacts, exports.
- File storage: artifacts, exports (md/pdf).
- Audit trail: minimal (errors, retries, export events).

## 8. Data model (initial)

### 8.1 Tables
- users (Supabase auth)
- profiles: id, user_id, display_name, avatar_url, created_at
- sessions: id, user_id, title, mode, created_at, updated_at, status
- turns: id, session_id, persona, role, content, tokens, created_at, order
- artifacts: id, session_id, filename, mime, size, status, parsed_text, created_at
- exports: id, session_id, format, storage_path, created_at
- retention_events: id, user_id, event_type, created_at

### 8.2 Status enums
- session.status: active, archived
- artifact.status: uploaded, parsing, ready, failed
- export.format: md, pdf

## 9. Session flow (happy path)
1. User authenticates and enters dashboard.
2. User initializes council, selects mode and personas.
3. Session created, meeting room loads.
4. User submits prompt and selects persona(s).
5. Backend validates input and enqueues LLM job.
6. Streaming begins, tokens update UI in real time.
7. User uploads artifacts; parsing job runs async.
8. Parsed artifact becomes available and is injected into prompts.
9. Session persists and is replayable at any time.
10. Export to md/pdf and optional public share.

## 10. LLM orchestration design
- Distinct system prompt per persona.
- Prompt structure:
  - persona system prompt
  - council mode (brainstorm, shark tank, etc.)
  - full conversation history
  - parsed artifacts (if ready)
  - user prompt
- Turn logic:
  - user selects persona(s) for the turn
  - sequential responses in selected order
  - explicit turn count stored
- Cross-persona dynamics:
  - prompt includes last N persona responses as references
  - persona-specific instructions on how to respond to others

## 11. Artifact pipeline
- Upload validation: mime + size + extension.
- Store file in Supabase storage.
- Enqueue parse job with Bull.
- Parse output stored in artifacts.parsed_text.
- UI notified via websocket event and toast.

## 12. Streaming
- Backend streams tokens as they arrive.
- Client renders tokens to debate log.
- Retry and reconnection:
  - resumable stream for network drops
  - graceful error fallback to cached response

## 13. Security and validation
- Input validation with Zod + regex blocklist.
- Artifact parsing sandboxed in worker.
- Rate limit per user and per session.
- Basic OpenAI moderation API for public share (post-MVP).

## 14. Performance and cost plan
- Target < 3s to first token.
- Async parsing, no blocking on upload.
- Cache prior persona response for fallback.
- Monitor token usage per session weekly.

## 15. UX requirements (pixel aesthetic)
- Retro-futuristic UI with pixel-art elements.
- Persona frames like retro video panels.
- Idle and speaking animations.
- Ambient CRT flicker, subtle scanline texture.
- Terminology avoids generic SaaS terms.

## 16. Testing strategy
- Unit tests: validation, turn logic, prompt assembly.
- Integration tests: LLM streaming, websocket reconnect.
- E2E tests: session create, turn, artifact upload, export.
- Load tests: 100 concurrent users baseline.

## 17. Release plan (9 weeks)

### Week 1-2: Foundation
- Supabase schema + auth.
- React + Tailwind scaffold.
- Fastify + TypeScript scaffold.
- Deploy pipelines.

### Week 3-4: Core session engine
- Session CRUD.
- Persona prompts and turn logic.
- LLM streaming integration.
- Queue setup with Bull + Redis.

### Week 5-6: Real-time streaming UX
- Websocket streaming.
- Debate log UI with token streaming.
- Persistence and replay.

### Week 7: Artifacts
- Upload UI.
- Worker parsing pipeline.
- Toast + ready signal.

### Week 8: Export + sharing
- Markdown export.
- PDF export.
- Public session share.

### Week 9: Polish
- Animation pass.
- Error handling and retries.
- Performance testing.
- Retention tracking.

## 18. Risk register (top)
- Token burn on free tier: add turn ceiling and usage alerts.
- Context overflow: cap turns, then prompt to open new session.
- Prompt injection: tighten blocklist and test adversarial inputs.
- Streaming instability: retry logic + cached fallback.
- Parsing latency: async jobs + file size limits.

## 19. Open questions
- GitHub token expiration timeline.
- Public share moderation flow.
- Exact turn/token ceiling and UX messaging.
- Session replay storage: store full responses vs regenerate.
- Export fidelity: plain md vs styled pdf.

## 20. Acceptance checklist
- Login works with OAuth.
- Session can be created, resumed, and replayed.
- Persona responses stream live.
- Artifacts parse and appear in prompts.
- Export works for all sessions.
- Public share generates a stable URL.

## 21. Next actions
- Confirm token expiration status.
- Build persona system prompts and test in isolation.
- Start frontend scaffold with pixel UI primitives.
