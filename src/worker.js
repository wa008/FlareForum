import { ageHoursFromNow, hotRank } from './rank.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env, ctx, url);
      }
      if (url.pathname === '/auth/verify') {
        return await verifyMagicLink(request, env, url);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Unhandled error:', error);
      return json({ error: 'Internal server error' }, 500);
    }
  }
};

async function handleApi(request, env, ctx, url) {
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/api/health') {
    return json({ ok: true, now: new Date().toISOString() });
  }

  if (request.method === 'POST' && pathname === '/api/auth/request-login') {
    return requestLogin(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/auth/me') {
    return getMe(request, env);
  }
  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    return logout();
  }
  if (request.method === 'POST' && pathname === '/api/auth/register-invite') {
    return registerWithInvite(request, env);
  }
  if (request.method === 'GET' && pathname === '/api/auth/oauth/google') {
    return json({ error: 'Not implemented in MVP yet' }, 501);
  }
  if (request.method === 'GET' && pathname === '/api/auth/oauth/github') {
    return json({ error: 'Not implemented in MVP yet' }, 501);
  }

  if (request.method === 'POST' && pathname === '/api/invites') {
    return createInvite(request, env);
  }

  if (request.method === 'GET' && pathname === '/api/posts') {
    return listPosts(request, env, ctx, url);
  }
  if (request.method === 'POST' && pathname === '/api/posts') {
    return createPost(request, env);
  }

  const postDetailMatch = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (request.method === 'GET' && postDetailMatch) {
    return getPost(env, Number(postDetailMatch[1]));
  }

  const postCommentMatch = pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (request.method === 'POST' && postCommentMatch) {
    return createComment(request, env, Number(postCommentMatch[1]));
  }

  const adminDeletePostMatch = pathname.match(/^\/api\/admin\/posts\/(\d+)$/);
  if (request.method === 'DELETE' && adminDeletePostMatch) {
    return adminDeletePost(request, env, Number(adminDeletePostMatch[1]));
  }

  const adminBanUserMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (request.method === 'POST' && adminBanUserMatch) {
    return adminBanUser(request, env, Number(adminBanUserMatch[1]));
  }

  if (request.method === 'GET' && pathname === '/api/admin/invites') {
    return adminInviteLogs(request, env);
  }

  return json({ error: 'Not found' }, 404);
}

async function requestLogin(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: 'Invalid email' }, 400);

  const tooFrequent = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM login_tokens WHERE email = ? AND created_at >= datetime('now', '-15 minutes')`
  ).bind(email).first();
  if ((tooFrequent?.cnt ?? 0) >= 5) {
    return json({ error: 'Too many requests, try again later' }, 429);
  }

  const hasAnyUsers = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM users`).first();
  const existingUser = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ? LIMIT 1`
  ).bind(email).first();

  if (!existingUser && (hasAnyUsers?.cnt ?? 0) > 0) {
    return json({ error: 'No account found for this email. Request an invite first.' }, 404);
  }

  const token = randomToken();
  const tokenHash = await sha256(token + env.SESSION_SECRET);
  const minutes = Number(env.MAGIC_LINK_TTL_MINUTES ?? 15);
  const expiresAt = isoInMinutes(minutes);

  await env.DB.prepare(
    `INSERT INTO login_tokens(email, token_hash, expires_at) VALUES(?, ?, ?)`
  ).bind(email, tokenHash, expiresAt).run();

  const verifyUrl = `${env.APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(env, {
    to: email,
    subject: 'Your FlareForum login link',
    text: `Login link (expires in ${minutes} minutes): ${verifyUrl}`
  });

  await logAction(env, null, 'login_link_sent', 'email', null, JSON.stringify({ email }));
  return json({ ok: true, message: 'Login link sent' });
}

async function verifyMagicLink(request, env, url) {
  const token = url.searchParams.get('token') || '';
  if (!token) return new Response('Missing token', { status: 400 });

  const tokenHash = await sha256(token + env.SESSION_SECRET);
  const rec = await env.DB.prepare(
    `SELECT id, email FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1`
  ).bind(tokenHash).first();

  if (!rec) return new Response('Invalid or expired token', { status: 400 });

  await env.DB.prepare(`UPDATE login_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(rec.id).run();

  let user = await env.DB.prepare(`SELECT id, role, status FROM users WHERE email = ? LIMIT 1`).bind(rec.email).first();

  if (!user) {
    const hasAnyUsers = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM users`).first();
    if ((hasAnyUsers?.cnt ?? 0) > 0) {
      return new Response('No account found. Request an invite link first.', { status: 403 });
    }
    const username = uniqueUsernameFromEmail(rec.email);
    const insertRes = await env.DB.prepare(
      `INSERT INTO users(email, username, role) VALUES(?, ?, 'admin')`
    ).bind(rec.email, username).run();
    user = { id: insertRes.meta.last_row_id, role: 'admin', status: 'active' };
    await logAction(env, user.id, 'bootstrap_admin_created', 'user', user.id, JSON.stringify({ email: rec.email }));
  }

  if (user.status !== 'active') {
    return new Response('Account is banned', { status: 403 });
  }

  const sessionToken = randomToken();
  const sessionHash = await sha256(sessionToken + env.SESSION_SECRET);
  const ttlHours = Number(env.SESSION_TTL_HOURS ?? 168);
  const sessionExpires = isoInHours(ttlHours);

  await env.DB.prepare(
    `INSERT INTO sessions(user_id, token_hash, expires_at) VALUES(?, ?, ?)`
  ).bind(user.id, sessionHash, sessionExpires).run();

  const headers = new Headers({ location: '/' });
  headers.append('set-cookie', makeSessionCookie(sessionToken, ttlHours));
  return new Response(null, { status: 302, headers });
}

async function getMe(request, env) {
  const user = await requireAuth(request, env, false);
  if (!user) return json({ user: null });
  return json({ user });
}

async function logout() {
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': 'ff_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure' }
  });
}

async function registerWithInvite(request, env) {
  const body = await readJson(request);
  const token = String(body?.token || '');
  const username = normalizeUsername(body?.username);
  if (!token || !username) return json({ error: 'Token and username are required' }, 400);

  const tokenHash = await sha256(token + env.SESSION_SECRET);
  const invite = await env.DB.prepare(
    `SELECT id, inviter_user_id, invitee_email FROM invite_links
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`
  ).bind(tokenHash).first();

  if (!invite) return json({ error: 'Invalid or expired invite link' }, 400);

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`).bind(invite.invitee_email).first();
  if (existing) return json({ error: 'Email already registered' }, 409);

  const dupUsername = await env.DB.prepare(`SELECT id FROM users WHERE username = ? LIMIT 1`).bind(username).first();
  if (dupUsername) return json({ error: 'Username already taken' }, 409);

  const inserted = await env.DB.prepare(
    `INSERT INTO users(email, username, invited_by_user_id) VALUES(?, ?, ?)`
  ).bind(invite.invitee_email, username, invite.inviter_user_id).run();

  const userId = inserted.meta.last_row_id;
  await env.DB.prepare(
    `UPDATE invite_links SET used_at = CURRENT_TIMESTAMP, used_by_user_id = ? WHERE id = ?`
  ).bind(userId, invite.id).run();

  await logAction(env, userId, 'invite_accepted', 'invite_link', invite.id, JSON.stringify({ inviterUserId: invite.inviter_user_id }));

  const sessionToken = randomToken();
  const sessionHash = await sha256(sessionToken + env.SESSION_SECRET);
  const ttlHours = Number(env.SESSION_TTL_HOURS ?? 168);
  const sessionExpires = isoInHours(ttlHours);

  await env.DB.prepare(
    `INSERT INTO sessions(user_id, token_hash, expires_at) VALUES(?, ?, ?)`
  ).bind(userId, sessionHash, sessionExpires).run();

  return json(
    { ok: true, user: { id: userId, username, email: invite.invitee_email } },
    201,
    { 'set-cookie': makeSessionCookie(sessionToken, ttlHours) }
  );
}

async function createInvite(request, env) {
  const auth = await requireAuth(request, env, true);
  if (auth instanceof Response) return auth;

  const body = await readJson(request);
  const inviteeEmail = normalizeEmail(body?.email);
  if (!inviteeEmail) return json({ error: 'Invalid email' }, 400);
  if (inviteeEmail === auth.email) return json({ error: 'Cannot invite yourself' }, 400);

  const perDay = Number(env.INVITES_PER_DAY ?? 10);
  const perHour = Number(env.INVITES_PER_HOUR ?? 3);

  const dayCount = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM invite_links WHERE inviter_user_id = ? AND created_at >= datetime('now', '-1 day')`
  ).bind(auth.id).first();
  if ((dayCount?.cnt ?? 0) >= perDay) return json({ error: 'Daily invite limit reached' }, 429);

  const hourCount = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM invite_links WHERE inviter_user_id = ? AND created_at >= datetime('now', '-1 hour')`
  ).bind(auth.id).first();
  if ((hourCount?.cnt ?? 0) >= perHour) return json({ error: 'Hourly invite limit reached' }, 429);

  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ? LIMIT 1`
  ).bind(inviteeEmail).first();
  if (existing) return json({ error: 'This email is already registered' }, 409);

  const token = randomToken();
  const tokenHash = await sha256(token + env.SESSION_SECRET);
  const ttlHours = Number(env.INVITE_TTL_HOURS ?? 72);
  const expiresAt = isoInHours(ttlHours);

  const inserted = await env.DB.prepare(
    `INSERT INTO invite_links(inviter_user_id, invitee_email, token_hash, expires_at)
     VALUES(?, ?, ?, ?)`
  ).bind(auth.id, inviteeEmail, tokenHash, expiresAt).run();

  const registerUrl = `${env.APP_URL}/?invite=${encodeURIComponent(token)}`;
  await sendEmail(env, {
    to: inviteeEmail,
    subject: `${auth.username} invited you to FlareForum`,
    text: `Use this invite link to register (expires in ${ttlHours} hours): ${registerUrl}`
  });

  await logAction(
    env,
    auth.id,
    'invite_sent',
    'invite_link',
    inserted.meta.last_row_id,
    JSON.stringify({ inviteeEmail })
  );

  return json({ ok: true, inviteeEmail, expiresAt });
}

async function listPosts(request, env, ctx, url) {
  const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, 30);
  const offset = clampInt(url.searchParams.get('offset'), 0, 1000, 0);

  const cacheTtl = Number(env.CACHE_TTL_SECONDS ?? 15);
  const canCache = request.method === 'GET' && offset === 0;
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);

  if (canCache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let items;
  if (sort === 'new') {
    const rows = await env.DB.prepare(
      `SELECT p.id, p.title, p.url, p.body, p.score, p.created_at, u.username,
              COALESCE(COUNT(c.id), 0) AS comment_count
         FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN comments c ON c.post_id = p.id AND c.status = 'active'
        WHERE p.status = 'active'
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();
    items = rows.results;
  } else {
    const rows = await env.DB.prepare(
      `SELECT p.id, p.title, p.url, p.body, p.score, p.created_at, u.username,
              COALESCE(COUNT(c.id), 0) AS comment_count
         FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN comments c ON c.post_id = p.id AND c.status = 'active'
        WHERE p.status = 'active' AND p.created_at >= datetime('now', '-7 day')
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT 300`
    ).all();

    items = rows.results
      .map((row) => {
        const score = Number(row.score) + Number(row.comment_count || 0) * 2;
        const ageHours = ageHoursFromNow(row.created_at);
        return { ...row, rank: hotRank(score, ageHours) };
      })
      .sort((a, b) => b.rank - a.rank)
      .slice(offset, offset + limit);
  }

  const payload = json({ items, sort, limit, offset, refreshedAt: new Date().toISOString() }, 200, {
    'cache-control': `public, max-age=${cacheTtl}`
  });

  if (canCache) {
    ctx.waitUntil(cache.put(cacheKey, payload.clone()));
  }

  return payload;
}

async function createPost(request, env) {
  const auth = await requireAuth(request, env, true);
  if (auth instanceof Response) return auth;

  const body = await readJson(request);
  const title = String(body?.title || '').trim();
  const textBody = String(body?.body || '').trim();
  const rawUrl = String(body?.url || '').trim();

  if (!title || title.length > 160) return json({ error: 'Title is required and must be <= 160 chars' }, 400);
  if (!textBody && !rawUrl) return json({ error: 'Either body or url is required' }, 400);

  let normalizedUrl = null;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      normalizedUrl = parsed.toString();
    } catch {
      return json({ error: 'Invalid url' }, 400);
    }
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO posts(user_id, title, url, body) VALUES(?, ?, ?, ?)`
  ).bind(auth.id, title, normalizedUrl, textBody || null).run();

  const postId = inserted.meta.last_row_id;
  await logAction(env, auth.id, 'post_created', 'post', postId, null);
  return json({ ok: true, postId }, 201);
}

async function getPost(env, postId) {
  const post = await env.DB.prepare(
    `SELECT p.id, p.title, p.url, p.body, p.score, p.created_at, p.status, u.username
     FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.id = ? LIMIT 1`
  ).bind(postId).first();

  if (!post || post.status !== 'active') return json({ error: 'Post not found' }, 404);

  const comments = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, u.username
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? AND c.status = 'active'
     ORDER BY c.created_at ASC`
  ).bind(postId).all();

  return json({ post, comments: comments.results });
}

async function createComment(request, env, postId) {
  const auth = await requireAuth(request, env, true);
  if (auth instanceof Response) return auth;

  const post = await env.DB.prepare(`SELECT id FROM posts WHERE id = ? AND status = 'active'`).bind(postId).first();
  if (!post) return json({ error: 'Post not found' }, 404);

  const body = await readJson(request);
  const textBody = String(body?.body || '').trim();
  if (!textBody || textBody.length > 5000) {
    return json({ error: 'Comment body is required and must be <= 5000 chars' }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO comments(post_id, user_id, body) VALUES(?, ?, ?)`
  ).bind(postId, auth.id, textBody).run();

  await env.DB.prepare(`UPDATE posts SET score = score + 1 WHERE id = ?`).bind(postId).run();
  await logAction(env, auth.id, 'comment_created', 'post', postId, null);
  return json({ ok: true }, 201);
}

async function adminDeletePost(request, env, postId) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const updated = await env.DB.prepare(
    `UPDATE posts SET status = 'deleted' WHERE id = ? AND status = 'active'`
  ).bind(postId).run();

  if ((updated.meta.changes ?? 0) === 0) return json({ error: 'Post not found' }, 404);

  await logAction(env, auth.id, 'admin_delete_post', 'post', postId, null);
  return json({ ok: true });
}

async function adminBanUser(request, env, userId) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  if (auth.id === userId) return json({ error: 'Admin cannot ban self' }, 400);

  const updated = await env.DB.prepare(`UPDATE users SET status = 'banned' WHERE id = ? AND status = 'active'`).bind(userId).run();
  if ((updated.meta.changes ?? 0) === 0) return json({ error: 'User not found or already banned' }, 404);

  await logAction(env, auth.id, 'admin_ban_user', 'user', userId, null);
  return json({ ok: true });
}

async function adminInviteLogs(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const rows = await env.DB.prepare(
    `SELECT i.id, inviter.username AS inviter_username, i.invitee_email, i.created_at, i.expires_at,
            i.used_at, invitee.username AS invitee_username
     FROM invite_links i
     JOIN users inviter ON inviter.id = i.inviter_user_id
     LEFT JOIN users invitee ON invitee.id = i.used_by_user_id
     ORDER BY i.created_at DESC
     LIMIT 200`
  ).all();

  return json({ items: rows.results });
}

async function requireAuth(request, env, activeOnly) {
  const token = readSessionCookie(request.headers.get('cookie'));
  if (!token) return activeOnly ? json({ error: 'Authentication required' }, 401) : null;

  const tokenHash = await sha256(token + env.SESSION_SECRET);
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1`
  ).bind(tokenHash).first();

  if (!user) return activeOnly ? json({ error: 'Authentication required' }, 401) : null;
  if (activeOnly && user.status !== 'active') return json({ error: 'User banned' }, 403);
  return user;
}

async function requireAdmin(request, env) {
  const user = await requireAuth(request, env, true);
  if (user instanceof Response) return user;
  if (user.role !== 'admin') return json({ error: 'Admin only' }, 403);
  return user;
}

async function sendEmail(env, { to, subject, text }) {
  const provider = (env.EMAIL_PROVIDER || 'mock').toLowerCase();

  if (provider === 'mock') {
    console.log('[MOCK EMAIL]', JSON.stringify({ to, subject, text }));
    return;
  }

  if (provider !== 'resend') {
    throw new Error(`Unsupported email provider: ${provider}`);
  }

  const apiUrl = env.EMAIL_API_URL;
  const apiKey = env.EMAIL_API_KEY;
  const from = env.INVITE_EMAIL_FROM;

  if (!apiUrl || !apiKey || !from) {
    throw new Error('Email provider configuration missing');
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({ from, to, subject, text })
  });

  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`Email send failed: ${response.status} ${msg}`);
  }
}

async function logAction(env, actorUserId, action, targetType, targetId, details) {
  await env.DB.prepare(
    `INSERT INTO admin_logs(actor_user_id, action, target_type, target_id, details) VALUES(?, ?, ?, ?, ?)`
  ).bind(actorUserId, action, targetType, targetId, details).run();
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return null;
  return username;
}

function uniqueUsernameFromEmail(email) {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 18) || 'admin';
  const suffix = crypto.getRandomValues(new Uint8Array(3));
  const rand = Array.from(suffix, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
  return `${local}_${rand}`;
}

function makeSessionCookie(token, ttlHours) {
  const maxAge = ttlHours * 60 * 60;
  return `ff_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax; Secure`;
}

function readSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((v) => v.trim());
  for (const p of parts) {
    if (p.startsWith('ff_session=')) return p.slice('ff_session='.length);
  }
  return null;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(input) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return {};
  return request.json();
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isoInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function isoInHours(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}
