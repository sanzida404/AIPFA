'use strict';

require('dotenv').config();
const path = require('node:path');
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');

const sqlitePath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'finassist.db');
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before migrating.');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, login_id TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, verify_token TEXT,
  accounting_start TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ai_data_sharing INTEGER NOT NULL DEFAULT 1, ai_consent_at TEXT, first_name TEXT, last_name TEXT,
  username TEXT, recovery_email TEXT, avatar_data TEXT, pin_hash TEXT
);
CREATE TABLE IF NOT EXISTS verification_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS issued_login_ids (login_id TEXT PRIMARY KEY, issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trusted_devices (device_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS login_challenges (challenge_hash TEXT PRIMARY KEY, approval_hash TEXT UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_hash TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, pin_required INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS account_email_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, email TEXT NOT NULL, purpose TEXT NOT NULL CHECK (purpose IN ('set_recovery','promote_recovery')), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (attempt_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_login_attempts_reset ON login_attempts(reset_at);
CREATE TABLE IF NOT EXISTS security_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, event TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
CREATE TABLE IF NOT EXISTS budgets (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, month TEXT NOT NULL, total REAL NOT NULL, daily_total REAL NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month));
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL CHECK (type IN ('expense','income')), amount REAL NOT NULL, category TEXT NOT NULL, note TEXT, date TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_chat_user_id ON chat(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_recovery_email ON users(recovery_email COLLATE NOCASE) WHERE recovery_email IS NOT NULL;
`;

async function main() {
  const local = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const remote = createClient({ url, authToken });
  try {
    await remote.executeMultiple(schema);
    const tables = [
      'users', 'issued_login_ids', 'verification_tokens', 'sessions', 'trusted_devices',
      'login_challenges', 'account_email_tokens', 'login_attempts', 'security_events',
      'budgets', 'transactions', 'chat',
    ];
    for (const table of tables) {
      const existing = await remote.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
      if (Number(existing.rows[0].count) > 0) throw new Error(`Turso table ${table} already contains data. Migration stopped to prevent overwriting existing data.`);
    }
    let copied = 0;
    for (const table of tables) {
      const rows = local.prepare(`SELECT * FROM "${table}"`).all();
      if (!rows.length) continue;
      const columns = local.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
      const names = columns.map((column) => `"${column}"`).join(',');
      const placeholders = columns.map(() => '?').join(',');
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100).map((row) => ({
          sql: `INSERT INTO "${table}" (${names}) VALUES (${placeholders})`,
          args: columns.map((column) => row[column] == null ? null : row[column]),
        }));
        await remote.batch(batch, 'write');
      }
      copied += rows.length;
      console.log(`[MIGRATE] ${table}: ${rows.length} rows`);
    }
    console.log(`[MIGRATE] Finished. Copied ${copied} rows from ${sqlitePath}.`);
  } finally {
    local.close();
    await remote.close();
  }
}

main().catch((error) => { console.error('[MIGRATE ERROR]', error.message); process.exitCode = 1; });
