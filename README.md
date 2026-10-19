# FlareForum

FlareForum is an invite-only forum starter that runs on Cloudflare free-tier friendly services.

## Architecture

- **Cloudflare Pages Assets**: static frontend (`/web`)
- **Cloudflare Worker**: API + auth + invite flow (`/src/worker.js`)
- **Cloudflare D1**: persistent data (`users`, `invite_links`, `posts`, `comments`, `admin_logs`, sessions)

## MVP Features

- Email magic-link login
- Invite-by-email registration links (no static invite code)
- Invite quota/rate controls (hour/day)
- Post list/detail + comments
- `new` and `hot` sorting
- Admin APIs for ban/delete/invite logs
- Hacker News-inspired lightweight UI
- OAuth placeholders for Google/GitHub (reserved for later)

## Quick Start

### 1) Prerequisites

- Node.js 20+
- Wrangler CLI (`npm i -g wrangler` or use `npx wrangler`)
- Cloudflare account

### 2) Configure

1. Create a D1 database:
   ```bash
   wrangler d1 create flareforum-db
   ```
2. Copy generated `database_id` into `/wrangler.toml`.
3. Create local env file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
4. Set `SESSION_SECRET` and email settings in `.dev.vars`.

### 3) Run migrations

```bash
npm run db:migrate
```

For production:
```bash
npm run db:migrate:remote
```

### 4) Local development

```bash
npm run dev
```

Open `http://127.0.0.1:8787`.

### 5) Deploy

```bash
npm run deploy
```

## Core API Endpoints

- `POST /api/auth/request-login` - send magic login email
- `GET /auth/verify?token=...` - verify magic link and create session
- `POST /api/auth/register-invite` - register from invite token
- `POST /api/invites` - send invite link to email
- `GET /api/posts?sort=new|hot` - list posts
- `POST /api/posts` - create post
- `GET /api/posts/:id` - post detail and comments
- `POST /api/posts/:id/comments` - create comment
- `DELETE /api/admin/posts/:id` - admin delete post
- `POST /api/admin/users/:id/ban` - admin ban user
- `GET /api/admin/invites` - admin invite audit list

## Data Model

Initial schema and indexes are in:

- `/migrations/0001_init.sql`

Tables:

- `users`
- `sessions`
- `login_tokens`
- `invite_links`
- `posts`
- `comments`
- `admin_logs`

## Sorting and Refresh Strategy

- `new`: order by newest publish time
- `hot`: score + time decay (`score / (age_hours + 2)^1.5`)
- API response cache TTL defaults to 15s (`CACHE_TTL_SECONDS`)
- Frontend polling interval defaults to 30s

## Free-tier Optimization Notes

- Keep `hot` computation window limited (last 7 days)
- Cache first-page list responses
- Use short polling, no always-on websocket
- Store only minimal moderation logs for auditability

## Security Baseline

- Session cookie is `HttpOnly`, `SameSite=Lax`, `Secure`
- Tokens are SHA-256 hashed before storage
- Invite links are one-time and expiring
- Basic per-email and per-user request throttling
- Banned users are blocked from writing actions

## Email Provider

Default is `mock` mode (logs emails in Worker logs).

To use a real provider, set:

- `EMAIL_PROVIDER=resend`
- `EMAIL_API_URL`
- `EMAIL_API_KEY`
- `INVITE_EMAIL_FROM`

## Next Iterations

- Complete Google/GitHub OAuth login
- Notifications and digest emails
- Search and tag system
- Better moderation tooling
- Rich anti-spam controls
