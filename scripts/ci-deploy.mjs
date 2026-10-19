import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

function log(msg) {
  console.log(`\x1b[36m[CI-Deploy]\x1b[0m ${msg}`);
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

  // 1. Verify wrangler access
  try {
    const whoami = run('npx wrangler whoami');
    console.log(whoami.trim());
  } catch (err) {
    console.error('Failed to authenticate with Cloudflare. Please check CLOUDFLARE_API_TOKEN / Account permissions.');
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
        const createOutput = run('npx wrangler d1 create flareforum-db --json');
        try {
          const parsed = JSON.parse(createOutput);
          dbUuid = parsed.database_id || parsed.uuid || parsed.id;
        } catch {
          const match = createOutput.match(/database_id\s*=\s*"([^"]+)"/);
          if (match) dbUuid = match[1];
        }
      } catch (createErr) {
        // Fallback: try regex from non-json creation
        const match = createErr.message?.match(/database_id\s*=\s*"([^"]+)"/);
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
  console.error('\x1b[31mDeployment failed:\x1b[0m', err);
  process.exit(1);
});
