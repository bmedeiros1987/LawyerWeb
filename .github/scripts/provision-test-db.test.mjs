import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provision, cleanup } from './provision-test-db.mjs';
const containerId = 'b'.repeat(64), runId = 'a'.repeat(32), now = 1800000000000;
function harness() {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', CI_POSTGRES_CONTAINER: containerId,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: '/runner/temp', GITHUB_ENV: '/runner/env' };
  const files = new Map(), calls = [];
  const service = { id: containerId, image: 'postgres:16', running: true, created: new Date(now - 5000).toISOString(), ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] } };
  const io = { now: () => now, id: () => runId, exists: path => files.has(path), read: path => files.get(path),
    write: (path, data) => { if (files.has(path)) throw new Error('exists'); files.set(path, data); },
    append: (path, data) => files.set(path, data), remove: path => files.delete(path),
    docker: args => { calls.push(args); return args[0] === 'inspect' ? JSON.stringify(service) : args.at(-1).startsWith('SELECT') ? '0' : ''; } };
  return { env, io, files, calls, service };
}
const drops = h => h.calls.filter(c => c.includes('dropdb'));
const creates = h => h.calls.filter(c => c.at(-1).startsWith('CREATE DATABASE'));
test('new empty database precedes manifest; manifest excludes credentials; cleanup owns only that database', () => {
  const h = harness(); const m = provision(h.env, h.io);
  assert.equal(creates(h).length, 1); assert.equal(m.database, `mblz_test_${runId}`);
  assert.equal(JSON.stringify(m).includes('password'), false); assert.equal(JSON.stringify(m).includes('postgresql:'), false);
  assert.match(h.files.get(h.env.GITHUB_ENV), /RUN_DB_TESTS=1/);
  cleanup(h.env, h.io); cleanup(h.env, h.io);
  assert.equal(drops(h).length, 1); assert.equal(drops(h)[0].at(-1), m.database);
});
for (const change of [{ GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { CI_POSTGRES_CONTAINER: 'other' }, { GITHUB_RUN_ID: 'bad' }]) {
  test(`invalid runner context refused before any Docker operation: ${JSON.stringify(change)}`, () => {
    const h = harness(); Object.assign(h.env, change); assert.throws(() => provision(h.env, h.io)); assert.equal(h.calls.length, 0);
  });
}
for (const change of [{ id: 'c'.repeat(64) }, { image: 'other' }, { running: false }, { created: 'invalid' }, { created: new Date(now - 7200000).toISOString() }, { ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] } }]) {
  test(`wrong service refused without SQL: ${JSON.stringify(change)}`, () => {
    const h = harness(); Object.assign(h.service, change); assert.throws(() => provision(h.env, h.io));
    assert.equal(creates(h).length, 0); assert.equal(drops(h).length, 0); assert.equal(h.files.size, 0);
  });
}
test('CREATE failure never claims or drops a possibly preexisting database', () => {
  const h = harness(), docker = h.io.docker;
  h.io.docker = args => { if (args.at(-1).startsWith('CREATE DATABASE')) throw new Error('already exists'); return docker(args); };
  assert.throws(() => provision(h.env, h.io)); assert.equal(drops(h).length, 0); assert.equal(h.files.size, 0);
});
test('failed empty check drops only successfully created database without publishing a manifest', () => {
  const h = harness(), docker = h.io.docker;
  h.io.docker = args => args.at(-1).startsWith('SELECT') ? '1' : docker(args);
  assert.throws(() => provision(h.env, h.io)); assert.equal(drops(h).length, 1); assert.equal(h.files.size, 0);
});
test('failed environment export removes the created database and its manifest', () => {
  const h = harness(); h.io.append = () => { throw new Error('write failed'); };
  assert.throws(() => provision(h.env, h.io)); assert.equal(drops(h).length, 1); assert.equal(h.files.size, 0);
});
test('missing manifest cleanup makes zero Docker calls', () => {
  const h = harness(); cleanup(h.env, h.io); assert.equal(h.calls.length, 0);
});
for (const change of [{ database: 'production' }, { containerId: 'c'.repeat(64) }, { workflowRunId: 'other' }, { workflowRunAttempt: '2' }, { exclusive: false }]) {
  test(`cleanup rejects foreign ownership: ${JSON.stringify(change)}`, () => {
    const h = harness(), m = provision(h.env, h.io); h.calls.length = 0;
    h.files.set('/runner/temp/mblz-test-db.json', JSON.stringify({ ...m, ...change }));
    assert.throws(() => cleanup(h.env, h.io)); assert.equal(h.calls.length, 0);
  });
}
test('existing manifest is never overwritten or adopted', () => {
  const h = harness(); h.files.set('/runner/temp/mblz-test-db.json', '{}');
  assert.throws(() => provision(h.env, h.io)); assert.equal(h.calls.length, 0);
});
