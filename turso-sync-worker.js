'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createClient } = require('@libsql/client');

let client;
let transaction;

function jsonSafe(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return Number(item);
    if (item instanceof Uint8Array) return { __aipfaBytes: Buffer.from(item).toString('base64') };
    return item;
  });
}

function unpack(value) {
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === 'object') {
    if (typeof value.__aipfaBytes === 'string') return Buffer.from(value.__aipfaBytes, 'base64');
    for (const key of Object.keys(value)) value[key] = unpack(value[key]);
  }
  return value;
}

async function execute(sql, args = []) {
  return (transaction || client).execute({ sql, args });
}

function resultRows(result) {
  return result.rows.map((row) => {
    const object = {};
    for (const column of result.columns) object[column] = row[column];
    return object;
  });
}

async function handle(message) {
  if (message.type === 'ready') {
    client = createClient({ url: workerData.url, authToken: workerData.authToken });
    await client.execute('SELECT 1');
    return true;
  }
  if (message.type === 'begin') {
    if (transaction) throw new Error('Nested database transactions are not supported.');
    transaction = await client.transaction('write');
    return true;
  }
  if (message.type === 'commit') {
    if (!transaction) throw new Error('No database transaction is active.');
    const current = transaction;
    transaction = null;
    await current.commit();
    return true;
  }
  if (message.type === 'rollback') {
    if (transaction) {
      const current = transaction;
      transaction = null;
      await current.rollback();
    }
    return true;
  }
  if (message.type === 'exec') {
    await client.executeMultiple(message.sql);
    return true;
  }
  if (message.type === 'query') {
    const result = await execute(message.sql, message.args.map((value) => value === undefined ? null : value));
    if (message.mode === 'get') return resultRows(result)[0];
    if (message.mode === 'all') return resultRows(result);
    return {
      changes: Number(result.rowsAffected || 0),
      lastInsertRowid: result.lastInsertRowid == null ? 0 : Number(result.lastInsertRowid),
    };
  }
  if (message.type === 'close') {
    if (transaction) await transaction.rollback();
    await client.close();
    return true;
  }
  throw new Error(`Unknown Turso database command: ${message.type}`);
}

parentPort.on('message', async (message) => {
  try {
    const value = await handle(message);
    const payload = Buffer.from(jsonSafe({ ok: true, value }), 'utf8');
    if (payload.length > message.shared.byteLength - 4) throw new Error('Turso response exceeded the adapter buffer.');
    new Uint8Array(message.shared, 4, payload.length).set(payload);
    Atomics.store(new Int32Array(message.shared, 0, 1), 0, payload.length);
  } catch (error) {
    const payload = Buffer.from(jsonSafe({ ok: false, error: { message: error.message, code: error.code } }), 'utf8');
    new Uint8Array(message.shared, 4, payload.length).set(payload);
    Atomics.store(new Int32Array(message.shared, 0, 1), 0, payload.length);
  }
  Atomics.notify(new Int32Array(message.shared, 0, 1), 0);
});
