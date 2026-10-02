import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const inspectFormat = '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}},"created":{{json .Created}}}';
const nativeIO = {
  docker: args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  read: path => readFileSync(path, 'utf8'),
  write: (path, data) => writeFileSync(path, data, { flag: 'wx', mode: 0o600 }),
  append: (path, data) => appendFileSync(path, data),
  exists: existsSync,
  remove: unlinkSync,
  id: () => randomBytes(16).toString('hex'),
  now: Date.now,
};

function context(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted'
      || !/^[a-f0-9]{64}$/.test(env.CI_POSTGRES_CONTAINER ?? '')
      || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
      || !isAbsolute(env.RUNNER_TEMP ?? '') || !isAbsolute(env.GITHUB_ENV ?? '')) {
    throw new Error('Only the current GitHub-hosted job PostgreSQL service is supported.');
  }
  return { containerId: env.CI_POSTGRES_CONTAINER, workflowRunId: env.GITHUB_RUN_ID,
    workflowRunAttempt: env.GITHUB_RUN_ATTEMPT, manifestPath: join(env.RUNNER_TEMP, 'mblz-test-db.json') };
}
function inspect(ctx, io, provisioning) {
  // Never request Config.Env: service credentials are not diagnostic output.
  const service = JSON.parse(io.docker(['inspect', '--format', inspectFormat, ctx.containerId]));
  const port = service.ports?.['5432/tcp'];
  const age = io.now() - Date.parse(service.created);
  if (service.id !== ctx.containerId || service.image !== 'postgres:16' || service.running !== true
      || !Array.isArray(port) || port.length !== 1 || port[0].HostIp !== '127.0.0.1'
      || port[0].HostPort !== '5432' || (provisioning && (!Number.isFinite(age) || age < 0 || age > 3600000))) {
    throw new Error('PostgreSQL service identity, freshness or loopback binding was not confirmed.');
  }
}
function sql(ctx, io, database, query) {
  return io.docker(['exec', ctx.containerId, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query]);
}
function drop(ctx, io, database) {
  io.docker(['exec', ctx.containerId, 'dropdb', '-U', 'postgres', '--force', '--if-exists', database]);
}
export function provision(env, io = nativeIO) {
  const ctx = context(env);
  if (io.exists(ctx.manifestPath)) throw new Error('Refusing to reuse an existing provisioning manifest.');
  inspect(ctx, io, true);
  const runId = io.id();
  if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error('Invalid generated run identifier.');
  const database = `mblz_test_${runId}`;
  // No IF NOT EXISTS: an existing database is never adopted as this run's resource.
  sql(ctx, io, 'postgres', `CREATE DATABASE "${database}"`);
  let manifestWritten = false;
  try {
    const count = sql(ctx, io, database, "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'");
    if (count !== '0') throw new Error('New test database was not empty.');
    const manifest = { runId, database, host: '127.0.0.1', port: 5432, disposable: true, exclusive: true,
      expiresAt: io.now() + 3600000, containerId: ctx.containerId, workflowRunId: ctx.workflowRunId,
      workflowRunAttempt: ctx.workflowRunAttempt, provisionedBy: 'github-service-create-database' };
    io.write(ctx.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    manifestWritten = true;
    // Credentials below are the existing synthetic CI service values, never user credentials.
    io.append(env.GITHUB_ENV, `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/${database}\nDB_TEST_RUN_ID=${runId}\nDB_TEST_MANIFEST=${ctx.manifestPath}\nRUN_DB_TESTS=1\n`);
    return manifest;
  } catch (error) {
    // CREATE succeeded: cleanup owns exactly this generated database. If CREATE's
    // outcome was uncertain, do not guess; GitHub tears down the entire service.
    drop(ctx, io, database);
    if (manifestWritten) io.remove(ctx.manifestPath);
    throw error;
  }
}
export function cleanup(env, io = nativeIO) {
  const ctx = context(env);
  if (!io.exists(ctx.manifestPath)) return;
  const m = JSON.parse(io.read(ctx.manifestPath));
  if (!/^[a-f0-9]{32}$/.test(m.runId ?? '') || m.database !== `mblz_test_${m.runId}`
      || m.containerId !== ctx.containerId || m.workflowRunId !== ctx.workflowRunId
      || m.workflowRunAttempt !== ctx.workflowRunAttempt || m.host !== '127.0.0.1' || m.port !== 5432
      || m.disposable !== true || m.exclusive !== true || m.provisionedBy !== 'github-service-create-database') {
    throw new Error('Cleanup ownership was not confirmed.');
  }
  inspect(ctx, io, false);
  drop(ctx, io, m.database);
  io.remove(ctx.manifestPath);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'provision') provision(process.env);
    else if (process.argv[2] === 'cleanup') cleanup(process.env);
    else throw new Error('Expected provision or cleanup.');
  } catch {
    // Do not echo subprocess output, URLs or environment values.
    console.error('Disposable database operation failed; no existing database may be substituted.');
    process.exitCode = 1;
  }
}
