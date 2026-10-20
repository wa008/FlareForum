import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

function log(msg) {
  console.log(`\x1b[36m[CI-Deploy]\x1b[0m ${msg}`);
}

function maskSecret(str, keepStart = 4, keepEnd = 4) {
  if (!str) return '<未设置/为空>';
  const s = String(str).trim();
  if (s.length <= keepStart + keepEnd) {
    return '***';
  }
  const start = s.slice(0, keepStart);
  const end = s.slice(-keepEnd);
  return `${start}${'*'.repeat(Math.min(s.length - keepStart - keepEnd, 12))}${end} (长度: ${s.length})`;
}

function sanitizeOutput(text) {
  if (!text) return text;
  let clean = String(text);
  const sensitiveVars = [
    process.env.CLOUDFLARE_API_TOKEN,
    process.env.GMAIL_APP_PASSWORD,
    process.env.SESSION_SECRET
  ];
  for (const secret of sensitiveVars) {
    if (secret && secret.length >= 6) {
      clean = clean.split(secret).join('***MASKED***');
    }
  }
  return clean;
}

function run(cmd, envOverrides = {}) {
  console.log(`\x1b[90m$ ${cmd}\x1b[0m`);
  return execSync(cmd, {
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env, ...envOverrides }
  });
}

function runInteractive(cmd, input = null, envOverrides = {}) {
  console.log(`\x1b[90m$ ${cmd}\x1b[0m`);
  return execSync(cmd, {
    input,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    env: { ...process.env, ...envOverrides }
  });
}

async function main() {
  log('Starting Cloudflare automated deployment...');

  // Diagnostic info (masked)
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  log(`Diagnostics: CLOUDFLARE_API_TOKEN = ${maskSecret(token)}`);
  log(`Diagnostics: CLOUDFLARE_ACCOUNT_ID = ${maskSecret(accountId, 6, 4)}`);

  // 1. Verify wrangler access
  try {
    const whoami = run('npx wrangler whoami');
    console.log(sanitizeOutput(whoami.trim()));
  } catch (err) {
    console.error('\x1b[31m[CI-Deploy] Failed to authenticate with Cloudflare.\x1b[0m');
    if (err.stderr) console.error(sanitizeOutput(err.stderr.toString()));
    if (err.stdout) console.error(sanitizeOutput(err.stdout.toString()));
    if (err.message && !err.stderr && !err.stdout) console.error(sanitizeOutput(err.message));
    process.exit(1);
  }

  // 2. Read wrangler.toml
  const tomlPath = 'wrangler.toml';
  let tomlContent = fs.readFileSync(tomlPath, 'utf-8');

  // Check if D1 database_id needs setup
  const isPlaceholderId = tomlContent.includes('REPLACE_WITH_D1_DATABASE_ID');
  const dbIdMatch = tomlContent.match(/database_id\s*=\s*"([^"]+)"/);
  const currentDbId = dbIdMatch ? dbIdMatch[1] : null;

  if (isPlaceholderId || !currentDbId) {
    log('D1 database_id is placeholder or unconfigured. Checking remote Cloudflare D1 databases...');
    let dbUuid = null;

    try {
      const listOutput = run('npx wrangler d1 list --json');
      const databases = JSON.parse(listOutput);
      const existing = databases.find((db) => db.name === 'flareforum-db');
      if (existing) {
        dbUuid = existing.uuid;
        log(`Found existing D1 database 'flareforum-db' with UUID: ${dbUuid}`);
      }
    } catch (e) {
      log('Could not list D1 databases via JSON: ' + e.message);
    }

    if (!dbUuid) {
      log("Creating remote D1 database 'flareforum-db'...");
      try {
        const createOutput = run('npx wrangler d1 create flareforum-db');
        const match = createOutput.match(/database_id\s*=\s*"([^"]+)"/);
        if (match) dbUuid = match[1];
      } catch (createErr) {
        const match = (createErr.stdout?.toString() || createErr.stderr?.toString() || createErr.message || '').match(/database_id\s*=\s*"([^"]+)"/);
        if (match) dbUuid = match[1];
        else throw createErr;
      }
      log(`Created D1 database 'flareforum-db' with UUID: ${dbUuid}`);
    }

    if (dbUuid) {
      tomlContent = tomlContent.replace(
        /database_id\s*=\s*"[^"]*"/,
        `database_id = "${dbUuid}"`
      );
      fs.writeFileSync(tomlPath, tomlContent, 'utf-8');
      log('Updated wrangler.toml with new D1 database_id.');
    } else {
      throw new Error('Failed to obtain D1 database ID for flareforum-db');
    }
  } else {
    log(`Using configured D1 database_id: ${currentDbId}`);
  }

  // 3. Secrets configuration
  log('Configuring Worker secrets...');
  
  // SESSION_SECRET
  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  try {
    runInteractive('npx wrangler secret put SESSION_SECRET', sessionSecret);
    log('SESSION_SECRET configured.');
  } catch (err) {
    console.warn('Notice: SESSION_SECRET put warning:', err.message);
  }

  // 3.1 Admin Emails Aggregation (Cloudflare account email + GMAIL_USER + ADMIN_EMAILS)
  log('Aggregating administrator emails...');
  const adminEmailSet = new Set();

  try {
    const whoami = run('npx wrangler whoami');
    const cfEmailMatch = whoami.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (cfEmailMatch) {
      adminEmailSet.add(cfEmailMatch[0].toLowerCase());
      log(`Detected Cloudflare account email: ${cfEmailMatch[0]}`);
    }
  } catch {}

  if (process.env.GMAIL_USER) {
    adminEmailSet.add(process.env.GMAIL_USER.trim().toLowerCase());
    log(`Added Gmail sender as admin: ${process.env.GMAIL_USER}`);
  }

  const explicitAdminEmails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL;
  if (explicitAdminEmails) {
    explicitAdminEmails.split(',').forEach((e) => {
      const trimmed = e.trim().toLowerCase();
      if (trimmed.includes('@')) {
        adminEmailSet.add(trimmed);
        log(`Added custom admin email: ${trimmed}`);
      }
    });
  }

  const finalAdminEmails = Array.from(adminEmailSet).join(',');
  if (finalAdminEmails) {
    log(`Setting ADMIN_EMAILS: ${finalAdminEmails}`);
    runInteractive('npx wrangler secret put ADMIN_EMAILS', finalAdminEmails);
  } else {
    console.warn('Notice: No administrator emails detected or configured.');
  }

  // Gmail / Email configuration
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (gmailUser && gmailPass) {
    log('Injecting Gmail secrets (GMAIL_USER & GMAIL_APP_PASSWORD)...');
    runInteractive('npx wrangler secret put GMAIL_USER', gmailUser);
    runInteractive('npx wrangler secret put GMAIL_APP_PASSWORD', gmailPass.replace(/\s+/g, ''));
    runInteractive('npx wrangler secret put EMAIL_PROVIDER', 'gmail');
    runInteractive('npx wrangler secret put INVITE_EMAIL_FROM', gmailUser);
    log('Gmail configuration successfully set.');
  } else {
    log('GMAIL_USER/GMAIL_APP_PASSWORD not provided in CI secrets, retaining default EMAIL_PROVIDER.');
  }

  // 4. Apply remote database migrations
  log('Applying remote D1 migrations...');
  runInteractive('npx wrangler d1 migrations apply flareforum-db --remote --yes');
  log('D1 migrations applied successfully.');

  // 5. Deploy Worker and Static Assets
  log('Deploying Worker and static assets...');
  const deployOutput = run('npx wrangler deploy');
  console.log(deployOutput);

  // 6. Capture production domain and configure APP_URL
  const match = deployOutput.match(/https:\/\/[a-zA-Z0-9-._]+\.workers\.dev/);
  const workerUrl = match ? match[0] : null;
  const explicitAppUrl = process.env.APP_URL;

  const finalAppUrl = explicitAppUrl || workerUrl;

  if (finalAppUrl) {
    log(`Syncing APP_URL to: ${finalAppUrl}`);
    runInteractive('npx wrangler secret put APP_URL', finalAppUrl);

    // 7. Health check
    log('Performing automated post-deployment health check...');
    try {
      const healthCheckUrl = `${finalAppUrl}/api/health`;
      log(`Calling ${healthCheckUrl}...`);
      const healthRes = run(`curl -s -f --retry 3 --retry-delay 3 "${healthCheckUrl}"`);
      log(`Health Check Response: ${healthRes.trim()}`);
    } catch (e) {
      console.warn('Health check warning (service may still be propagating DNS):', e.message);
    }
  }

  log('🎉 Cloudflare automated deployment completed successfully!');
}

main().catch((err) => {
  console.error('\x1b[31mDeployment failed:\x1b[0m', err.message || err);
  if (err.stderr) console.error(sanitizeOutput(err.stderr.toString()));
  if (err.stdout) console.error(sanitizeOutput(err.stdout.toString()));
  process.exit(1);
});
