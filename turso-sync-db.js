'use strict';

// Compatibility adapter for the app's existing better-sqlite3 call pattern.
// Turso calls are handled by a worker so database reads/writes stay synchronous
// to the application code and existing route behavior remains intact.
const { Worker } = require('node:worker_threads');
const path = require('node:path');

const BUFFER_SIZE = 16 * 1024 * 1024;

class TursoSyncDatabase {
  constructor(url, authToken) {
    this.worker = new Worker(path.join(__dirname, 'turso-sync-worker.js'), {
      workerData: { url, authToken },
    });
    this.closed = false;
    this.worker.on('error', (error) => { this.workerError = error; });
    this.worker.on('exit', (code) => {
      if (code !== 0) this.workerError = new Error(`Turso database worker exited (${code}).`);
    });
    this.call({ type: 'ready' });
  }

  call(command) {
    if (this.workerError) throw this.workerError;
    if (this.closed) throw new Error('Database is closed.');
    const shared = new SharedArrayBuffer(4 + BUFFER_SIZE);
    const header = new Int32Array(shared, 0, 1);
    this.worker.postMessage({ ...command, shared });
    const waitResult = Atomics.wait(header, 0, 0, 120000);
    if (waitResult === 'timed-out') throw new Error('Turso database request timed out.');
    const size = Atomics.load(header, 0);
    const text = Buffer.from(new Uint8Array(shared, 4, size)).toString('utf8');
    const response = JSON.parse(text);
    if (!response.ok) {
      const error = new Error(response.error?.message || 'Turso database request failed.');
      if (response.error?.code) error.code = response.error.code;
      throw error;
    }
    return response.value;
  }

  prepare(sql) {
    const tableInfo = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s*;?\s*$/i);
    if (tableInfo) {
      const table = tableInfo[1];
      return {
        get: (...args) => this.call({ type: 'query', mode: 'get', sql: `SELECT name FROM pragma_table_info('${table}')`, args }),
        all: (...args) => this.call({ type: 'query', mode: 'all', sql: `SELECT name FROM pragma_table_info('${table}')`, args }),
        run: () => { throw new Error('PRAGMA table_info cannot be run as an update.'); },
      };
    }
    return {
      get: (...args) => this.call({ type: 'query', mode: 'get', sql, args }),
      all: (...args) => this.call({ type: 'query', mode: 'all', sql, args }),
      run: (...args) => this.call({ type: 'query', mode: 'run', sql, args }),
    };
  }

  exec(sql) {
    this.call({ type: 'exec', sql });
    return this;
  }

  pragma(statement) {
    // Journal mode is managed by Turso. Foreign keys are enabled by the
    // service; these PRAGMAs are only needed for the local SQLite backend.
    if (/^\s*(?:journal_mode|foreign_keys)\b/i.test(statement)) return undefined;
    return this.call({ type: 'query', mode: 'all', sql: `PRAGMA ${statement}`, args: [] });
  }

  transaction(callback) {
    const db = this;
    return function transactionWrapper(...args) {
      db.call({ type: 'begin' });
      try {
        const result = callback.apply(this, args);
        db.call({ type: 'commit' });
        return result;
      } catch (error) {
        try { db.call({ type: 'rollback' }); } catch {}
        throw error;
      }
    };
  }

  close() {
    if (this.closed) return;
    this.call({ type: 'close' });
    this.closed = true;
    this.worker.terminate();
  }
}

module.exports = TursoSyncDatabase;
