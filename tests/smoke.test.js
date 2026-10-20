'use strict';

// Isolated HTTP smoke tests. Uses a disposable SQLite database and synthetic users only.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const testDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dhaka' }).format(new Date());

let tempDir, dbPath, baseUrl, serverProcess, userCookie, otherCookie;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function json(pathname, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { response, data: await response.json().catch(() => ({})) };
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aipfa-smoke-'));
  dbPath = path.join(tempDir, 'smoke.db');
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port), BASE_URL: baseUrl, DB_PATH: dbPath, DEMO_SEED: 'false', TRUST_PROXY: '0',
    OPENROUTER_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', UNOSEND_API_KEY: '', BREVO_API_KEY: '',
  };
  serverProcess = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  serverProcess.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  serverProcess.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/me`);
      if (response.status === 401) { ready = true; break; }
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Sandbox server did not start. ${output}`);

  const db = new Database(dbPath);
  const hash = bcrypt.hashSync('SmokePass123', 4);
  db.prepare('INSERT INTO users (email, login_id, pass_hash, verified) VALUES (?,?,?,1)')
    .run('smoke-user@example.test', 'FA900001', hash);
  db.prepare('INSERT INTO users (email, login_id, pass_hash, verified) VALUES (?,?,?,1)')
    .run('other-user@example.test', 'FA900002', hash);
  const users = db.prepare('SELECT id, login_id FROM users ORDER BY id').all();
  const deviceTokens = ['smoke-device-user-one', 'smoke-device-user-two'];
  const addTrustedDevice = db.prepare('INSERT INTO trusted_devices (device_hash, user_id) VALUES (?, ?)');
  users.forEach((user, index) => addTrustedDevice.run(crypto.createHash('sha256').update(deviceTokens[index]).digest('hex'), user.id));
  db.close();

  const loginA = await json('/api/login', { method: 'POST', cookie: `aipfa_device=${deviceTokens[0]}`, body: { id: 'FA900001', password: 'SmokePass123' } });
  const loginB = await json('/api/login', { method: 'POST', cookie: `aipfa_device=${deviceTokens[1]}`, body: { id: 'FA900002', password: 'SmokePass123' } });
  assert.equal(loginA.response.status, 200);
  assert.equal(loginB.response.status, 200);
  userCookie = loginA.response.headers.get('set-cookie').split(';')[0];
  otherCookie = loginB.response.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('sandbox: authentication, ledger ownership, budget math, and privacy permission', async (t) => {
  await t.test('public app assets are revalidated for ordinary browser refreshes', async () => {
    for (const asset of ['/','/app.js','/style.css','/sw.js']) {
      const response = await fetch(`${baseUrl}${asset}`);
      assert.equal(response.status, 200, `${asset} should be served`);
      assert.match(response.headers.get('cache-control'), /no-cache, must-revalidate/);
    }
  });

  await t.test('session and account profile', async () => {
    const { response, data } = await json('/api/me', { cookie: userCookie });
    assert.equal(response.status, 200);
    assert.equal(data.loginId, 'FA900001');
    assert.equal(data.aiDataSharing, false, 'existing accounts must explicitly consent after migration');
  });

  await t.test('transaction validation and user data isolation', async () => {
    const income = await json('/api/transactions', { method: 'POST', cookie: userCookie, body: { type: 'income', amount: 1000, date: testDate, note: 'synthetic salary' } });
    assert.equal(income.response.status, 200);
    const expense = await json('/api/transactions', { method: 'POST', cookie: userCookie, body: { type: 'expense', amount: 60, category: 'Food', date: testDate, note: 'synthetic groceries' } });
    assert.equal(expense.response.status, 200);
    const tooMuch = await json('/api/transactions', { method: 'POST', cookie: userCookie, body: { type: 'expense', amount: 2000, category: 'Food', date: testDate } });
    assert.equal(tooMuch.response.status, 400);
    const mine = await json('/api/transactions', { cookie: userCookie });
    const theirs = await json('/api/transactions', { cookie: otherCookie });
    assert.equal(mine.data.length, 2);
    assert.equal(theirs.data.length, 0);
  });

  await t.test('budget setting and summary calculation', async () => {
    const profile = await json('/api/me', { cookie: userCookie });
    const saved = await json('/api/budget', { method: 'POST', cookie: userCookie, body: { total: 200, dailyTotal: 10, month: profile.data.currentPeriod } });
    assert.equal(saved.response.status, 200);
    const summary = await json(`/api/summary?periodStart=${encodeURIComponent(profile.data.currentPeriod)}`, { cookie: userCookie });
    assert.equal(summary.response.status, 200);
    assert.equal(summary.data.income, 1000);
    assert.equal(summary.data.spent, 60);
    assert.equal(summary.data.balance, 940);
    assert.equal(summary.data.budget, 200);
  });

  await t.test('AI permission blocks external processing; local data remains accessible', async () => {
    const optedIn = await json('/api/privacy', { method: 'POST', cookie: userCookie, body: { aiDataSharing: true } });
    assert.equal(optedIn.response.status, 200);
    assert.equal(optedIn.data.aiDataSharing, true);
    const optedOut = await json('/api/privacy', { method: 'POST', cookie: userCookie, body: { aiDataSharing: false } });
    assert.equal(optedOut.response.status, 200);
    const chat = await json('/api/chat', { method: 'POST', cookie: userCookie, body: { message: 'Summarize my budget' } });
    assert.equal(chat.response.status, 403);
    const bill = await json('/api/bill/analyze', { method: 'POST', cookie: userCookie, body: { image: 'not-an-image', mimeType: 'image/png' } });
    assert.equal(bill.response.status, 403);
    const local = await json('/api/summary', { cookie: userCookie });
    assert.equal(local.response.status, 200);
  });

  await t.test('bill input validation and unauthenticated access', async () => {
    await json('/api/privacy', { method: 'POST', cookie: userCookie, body: { aiDataSharing: true } });
    const invalidBill = await json('/api/bill/analyze', { method: 'POST', cookie: userCookie, body: { image: 'not-an-image', mimeType: 'image/png' } });
    assert.equal(invalidBill.response.status, 400);
    const anonymous = await json('/api/transactions', { method: 'POST', body: { type: 'income', amount: 1 } });
    assert.equal(anonymous.response.status, 401);
  });

  await t.test('local report downloads remain available when AI sharing is disabled', async () => {
    for (const [format, mime] of [
      ['xlsx', 'spreadsheetml'], ['docx', 'wordprocessingml'], ['pdf', 'application/pdf'], ['pptx', 'presentationml'],
    ]) {
      const response = await fetch(`${baseUrl}/api/assistant/report?format=${format}&start=${testDate}&end=${testDate}`, { headers: { Cookie: userCookie } });
      assert.equal(response.status, 200, `${format} report should download without AI consent`);
      assert.match(response.headers.get('content-type'), new RegExp(mime));
      assert.ok((await response.arrayBuffer()).byteLength > 100);
    }
  });

  await t.test('assistant creates reports for an exact US date range and the current month', async () => {
    const [year, month, day] = testDate.split('-');
    const firstOfMonth = `${year}-${month}-01`;
    const monthLastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    const lastOfMonth = `${year}-${month}-${String(monthLastDay).padStart(2, '0')}`;
    const usRange = `${month}/01/${year} to ${month}/${day}/${year}`;

    const exact = await json('/api/chat', {
      method: 'POST', cookie: userCookie,
      body: { message: `Create a PDF budget summary from ${usRange}` },
    });
    assert.equal(exact.response.status, 200);
    assert.match(exact.data.reply, new RegExp(`${firstOfMonth} to ${testDate}`));
    const exactLink = exact.data.reply.match(/\/api\/assistant\/report\?[^\s]+/)[0];
    const exactFile = await fetch(`${baseUrl}${exactLink}`, { headers: { Cookie: userCookie } });
    assert.equal(exactFile.status, 200);
    assert.match(exactFile.headers.get('content-type'), /application\/pdf/);

    const monthReport = await json('/api/chat', {
      method: 'POST', cookie: userCookie,
      body: { message: 'Create a PowerPoint budget summary for this month' },
    });
    assert.equal(monthReport.response.status, 200);
    assert.match(monthReport.data.reply, new RegExp(`${firstOfMonth} to ${lastOfMonth}`));
    const monthLink = monthReport.data.reply.match(/\/api\/assistant\/report\?[^\s]+/)[0];
    const monthFile = await fetch(`${baseUrl}${monthLink}`, { headers: { Cookie: userCookie } });
    assert.equal(monthFile.status, 200);
    assert.match(monthFile.headers.get('content-type'), /presentationml/);
    assert.ok((await monthFile.arrayBuffer()).byteLength > 1000);
  });

  await t.test('weak passwords are rejected and account/network login failures are throttled', async () => {
    const weak = await json('/api/signup', { method: 'POST', body: { email: 'weak-pass@example.test', password: 'Pass1234' } });
    assert.equal(weak.response.status, 400);
    for (let i = 0; i < 8; i++) {
      const failed = await json('/api/login', { method: 'POST', body: { id: 'FA900001', password: 'WrongPassword123' } });
      assert.equal(failed.response.status, 401);
    }
    const blocked = await json('/api/login', { method: 'POST', body: { id: 'FA900001', password: 'WrongPassword123' } });
    assert.equal(blocked.response.status, 429);
  });
});

test('security events are recorded without storing credentials or raw network identifiers', () => {
  const db = new Database(dbPath, { readonly: true });
  const events = db.prepare('SELECT event, user_id FROM security_events').all();
  db.close();
  assert.ok(events.some((row) => row.event === 'login_success'));
  assert.ok(events.some((row) => row.event === 'login_failed'));
  assert.ok(events.some((row) => row.event === 'ai_sharing_enabled'));
  assert.ok(events.some((row) => row.event === 'ai_sharing_disabled'));
});

test('legacy database migration preserves accounts but requires new explicit AI consent', async () => {
  const legacyDbPath = path.join(tempDir, 'legacy.db');
  const legacyDb = new Database(legacyDbPath);
  legacyDb.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, login_id TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, verify_token TEXT,
    accounting_start TEXT, ai_data_sharing INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  legacyDb.exec(`CREATE TABLE trusted_devices (
    device_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  legacyDb.prepare('INSERT INTO users (email, login_id, pass_hash, verified, ai_data_sharing) VALUES (?,?,?,?,?)')
    .run('legacy-user@example.test', 'FA900003', bcrypt.hashSync('LegacyPass1234', 4), 1, 1);
  const legacyUser = legacyDb.prepare('SELECT id FROM users WHERE login_id=?').get('FA900003');
  const legacyDeviceToken = 'smoke-legacy-device';
  legacyDb.prepare('INSERT INTO trusted_devices (device_hash, user_id) VALUES (?, ?)')
    .run(crypto.createHash('sha256').update(legacyDeviceToken).digest('hex'), legacyUser.id);
  legacyDb.close();

  const port = await unusedPort();
  const legacyUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), BASE_URL: legacyUrl, DB_PATH: legacyDbPath, DEMO_SEED: 'false', TRUST_PROXY: '0', OPENROUTER_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`${legacyUrl}/api/me`)).status === 401) { ready = true; break; } } catch { /* startup wait */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'migrated server should start');
    const login = await fetch(`${legacyUrl}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `aipfa_device=${legacyDeviceToken}` },
      body: JSON.stringify({ id: 'FA900003', password: 'LegacyPass1234' }),
    });
    assert.equal(login.status, 200);
    const profile = await fetch(`${legacyUrl}/api/me`, { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).aiDataSharing, false);
  } finally {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
});

test('production refuses a non-HTTPS public base URL', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, NODE_ENV: 'production', BASE_URL: 'http://public.example.test' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production deployment requires an HTTPS BASE_URL/);
});
