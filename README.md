# Friend ID — مراسلة بالمعرّف الفريد

Next.js (App Router) + PostgreSQL (Drizzle ORM). No external services required.

## Authentication (persistent & secure)
- E-mail (or username) + password, hashed with **bcrypt**.
- Server-side sessions in the `sessions` table; only `SHA-256(token)` is stored.
- Token lives only in an **HttpOnly** cookie `fid_session` (`Max-Age` 30 days, sliding renewal,
  1-year absolute cap). Nothing sensitive is kept in `localStorage`/`sessionStorage`.
- On HTTPS the cookie is `Secure; SameSite=None; Partitioned` (works inside embedded previews);
  CSRF is blocked by a mandatory `x-fid-csrf` header on every state-changing request.
- Pages restore the session server-side (`/`, `/login`, `/register` → `/chat` when signed in).
- Sessions end only on explicit logout, revocation (Settings → devices), password change
  (other devices) or expiry. Logout never deletes conversations.

## Messaging
- Tables: `users`, `sessions`, `friendships`, `blocks`, `reports`, `conversations`,
  `conversation_members`, `messages`, `attachments`.
- Every message stores `sender_id`, `recipient_id`, `created_at`, `status`
  (`sent` → `delivered` → `read`), `delivered_at`, `read_at`.
- Idempotent sending: unique `(sender_id, client_id)` → retries never duplicate.
- Gap-free sync: per-conversation change counter (`seq` / `change_seq`) and
  `GET /api/conversations/:id/messages?since=<cursor>`.
- Realtime: Server-Sent Events (`/api/events`) fed by PostgreSQL `LISTEN/NOTIFY`
  (works across multiple server instances) + polling fallback.
- Client outbox: unsent text messages are kept locally and resent automatically after
  reconnecting or reloading.

## Media
Stored on disk in `storage/uploads` (override with `UPLOAD_DIR`), outside `/public`.
Metadata + access scope live in `attachments`; `/api/files/:id` serves files only to members
of the conversation (Range requests supported). Limits: image 10MB, video 100MB, audio 15MB,
file 50MB.

## Tests
```bash
npx drizzle-kit push              # apply schema
npm run build && npm start        # in another terminal
node scripts/e2e-test.mjs         # API/DB/disk end-to-end tests
# real-browser tests (Playwright installed outside the project):
PLAYWRIGHT_PATH=/tmp/uitest/node_modules/playwright/index.mjs node scripts/ui-test.mjs
```
