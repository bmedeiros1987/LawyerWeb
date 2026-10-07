// Deterministic production-function tests with a transactional SQL double.
// No database, user data, packaged app, or credentials are accessed.
// Node >= 24: node tests/synthetic/desktop-concurrency.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
const read = file => fs.readFileSync((process.env.SOURCE_ROOT ?? '.') + '/' + file, 'utf8');
const selected = process.env.CASE;
class DesktopError extends Error { constructor(message, status) { super(message); this.status = status; } }
let account, sessions, tail = Promise.resolve(), verificationHook;
const hash = (pw, salt) => crypto.createHash('sha512').update(pw).update(salt).digest();
const scrypt = async (pw, salt) => { if (verificationHook && pw === 'old-password-123') await verificationHook(); return hash(pw, salt); };
const query = async (strings, ...v) => {
  const sql = strings.join('?');
  if (sql.includes('returning true as ok')) return [{ ok: true }]; // reserveAttempt: account not locked
  if (sql.includes('select user_id, recovery_hash')) return [{ user_id: 'u', recovery_hash: account.recovery_hash }];
  if (sql.includes('select user_id')) return [{ ...account }];
  throw Error(sql);
};
const execute = async (strings, ...v) => {
  const sql = strings.join('?');
  if (sql.includes('set password_hash') && sql.includes('recovery_hash =')) {
    if (/and\s+recovery_hash =/.test(sql) && account.recovery_hash !== v[3]) return 0;
    account.password_hash = v[0]; account.recovery_hash = v[1]; return 1;
  }
  if (sql.includes('set failed_attempts = 0')) return 1;
  if (sql.includes('delete from desktop.local_session')) { if (!sql.includes('expires_at')) sessions = []; return 1; }
  if (sql.includes('insert into desktop.local_session')) { sessions.push(v[0]); return 1; }
  throw Error(sql);
};
const prisma = { $queryRaw: query, $executeRaw: execute, $transaction: async fn => {
  if (Array.isArray(fn)) return Promise.all(fn);
  const previous = tail; let release; tail = new Promise(r => release = r); await previous;
  const saved = { ...account }, savedSessions = [...sessions];
  try { return await fn(prisma); } catch (e) { account = saved; sessions = savedSessions; throw e; } finally { release(); }
} };
let source = read('lib/desktop/auth.ts').replace(/^import .*;\n/gm, '').replace(/^const scrypt = .*;\n/m, '').replace(/export /g, '');
source = stripTypeScriptTypes(source);
const auth = new Function('crypto', 'scrypt', 'prisma', 'DesktopError', source + '\nreturn { hashPassword, login, recoverOwner };')(crypto, scrypt, prisma, DesktopError);
const reset = async () => { account = { user_id: 'u', password_hash: await auth.hashPassword('old-password-123'), recovery_hash: crypto.createHash('sha256').update('KEY').digest('hex'), locked_until: null }; sessions = ['existing']; };
if (!selected || selected === 'recovery') {
await reset();
const recovery = await Promise.allSettled([auth.recoverOwner('owner@test.invalid', 'KEY', 'new-password-123'), auth.recoverOwner('owner@test.invalid', 'KEY', 'other-password-123')]);
assert.equal(recovery.filter(r => r.status === 'fulfilled').length, 1);
assert.equal(recovery.find(r => r.status === 'rejected').reason.status, 409);
assert.deepEqual(sessions, []);
console.log('PASS: concurrent recovery consumes key once and revokes sessions');
}
if (!selected || selected === 'login') {
await reset();
let resume, entered; const waiting = new Promise(r => entered = r); const barrier = new Promise(r => resume = r);
verificationHook = async () => { entered(); await barrier; };
const login = auth.login('owner@test.invalid', 'old-password-123'); await waiting;
await auth.recoverOwner('owner@test.invalid', 'KEY', 'new-password-123'); resume();
await assert.rejects(login, e => e.status === 401); assert.deepEqual(sessions, []); verificationHook = null;
console.log('PASS: old-password login started before reset cannot create a session');
}
if (!selected || selected === 'pool') {
// Load the production lock and settings functions with a six-client pool.
let active = 0, max = 0;
const pool = () => ({ connect: async () => { if (active === 6) throw Error('pool exhausted'); active++; max = Math.max(max, active); return { query: async sql => ({ rows: sql.includes('pg_try') ? [{ ok: true }] : [] }), release: () => active-- }; } });
let lockSource = read('lib/desktop/lock.ts').replace(/^import .*;\n/gm, '').replace(/export /g, '');
const lock = new Function('pool', 'DesktopError', stripTypeScriptTypes(lockSource) + '\nreturn withStoreLock;')(pool, DesktopError);
let settingsSource = read('lib/desktop/settings.ts').replace(/^import .*;\n/gm, '').replace(/export /g, '');
const root = new Function('fs', 'path', 'desktopStateDir', 'withClient', stripTypeScriptTypes(settingsSource) + '\nreturn documentsRoot;')({ readFileSync: () => { throw Object.assign(Error(), { code: 'ENOENT' }); } }, { join: (...p) => p.join('/') }, () => '/discardable', async fn => { const c = await pool().connect(); try { return await fn(c); } finally { c.release(); } });
await Promise.all(Array.from({ length: 6 }, () => lock('shared', c => root(c))));
assert.equal(max, 6); assert.equal(active, 0);
const docs = read('lib/desktop/documents.ts');
assert.match(docs, /client => importLocked\(input, client\)/);
assert.match(docs, /ensureWorkingRoot\(client\)/);
console.log('PASS: six concurrent lock holders resolve documentsRoot without a seventh connection');

}
