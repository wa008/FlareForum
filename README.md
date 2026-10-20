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

### Option 1: Gmail (Recommended for personal / low-cost setups)

Uses Cloudflare Workers native TCP Sockets (`cloudflare:sockets`) to connect directly to `smtp.gmail.com:465`.

1. Go to your [Google Account Security](https://myaccount.google.com/security).
2. Enable 2-Step Verification if not already enabled.
3. Search for or visit **App passwords** (`https://myaccount.google.com/apppasswords`).
4. Generate an App password (e.g. named "FlareForum"). You will receive a 16-character code.
5. Configure the following variables/secrets:
   - `EMAIL_PROVIDER=gmail`
   - `GMAIL_USER=your-account@gmail.com`
   - `GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx`
   - `INVITE_EMAIL_FROM=your-account@gmail.com`

### Option 2: Resend

- `EMAIL_PROVIDER=resend`
- `EMAIL_API_URL=https://api.resend.com/emails`
- `EMAIL_API_KEY=re_...`
- `INVITE_EMAIL_FROM=invite@your-domain.com`

## Automated Cloudflare Deployment (GitHub Actions CI/CD)

The project includes an end-to-end zero-touch automated deployment workflow (`.github/workflows/deploy.yml`).

### Step 1: Configure GitHub Repository Secrets

In your GitHub repository, go to **Settings** > **Secrets and variables** > **Actions** > **New repository secret**:

| Secret Name | Required? | Description |
| :--- | :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | **Yes** | Cloudflare API Token with Workers, D1 & Account edit permissions. |
| `CLOUDFLARE_ACCOUNT_ID` | **Yes** | 32-character Account ID from Cloudflare dashboard Workers overview. |
| `GMAIL_USER` | **Recommended** | Your Gmail email address. |
| `GMAIL_APP_PASSWORD` | **Recommended** | Your 16-character Google App Password. |
| `APP_URL` | *Optional* | Custom production domain. If omitted, the workflow automatically links your `*.workers.dev` domain. |
| `SESSION_SECRET` | *Optional* | A custom 32-byte secret. If omitted, the workflow automatically generates one and injects it. |
| `ADMIN_EMAILS` | *Optional* | Custom admin emails (comma-separated). The system already automatically includes your Cloudflare email and `GMAIL_USER`. |

### Step 2: Push to Main

Once secrets are saved, any `git push` to `main` (or clicking **Run workflow** on the Actions tab) will automatically:
1. Run test suite (`npm test`).
2. Auto-create the remote D1 database if not yet existing.
3. Auto-aggregate Administrator emails (Cloudflare Account Email + `GMAIL_USER` + `ADMIN_EMAILS`).
4. Auto-inject `SESSION_SECRET`, Admin emails, and Gmail credentials into Worker Secrets.
5. Auto-apply D1 migrations (`migrations/0001_init.sql`, `migrations/0002_admin_password.sql`).
6. Deploy Worker and `./web` static assets.
7. Synchronize `APP_URL` and run a health-check probe (`/api/health`).

## Administrator Account & Management

1. **Who is the Admin?**
   - Your Cloudflare account email (`zphu1024@gmail.com`) is automatically detected and granted admin privileges.
   - Your sender email (`GMAIL_USER`) is also automatically granted admin privileges.
   - You can also add more admin emails via the `ADMIN_EMAILS` secret.
2. **First-time Admin Login & Password Setup**:
   - On the forum homepage, enter your admin email and click **"Send Magic / Setup Link"**.
   - You will receive an activation email with a setup link. Click the link to set your admin password (min 8 characters).
   - Once set, you can log in directly anytime using **Email + Password**, without waiting for emails.
3. **Admin Control Panel**:
   - When logged in as admin, you can:
     - View and audit all invite links and their usage status.
     - Ban malicious users by user ID.
     - Delete posts directly with the `delete` button next to any post.

## Next Iterations

- Complete Google/GitHub OAuth login
- Notifications and digest emails
- Search and tag system
- Better moderation tooling
- Rich anti-spam controls

