// Disposable PostgreSQL validation. Never uses an existing DATABASE_URL/cluster.
// PG_BIN_DIR must be an already verified, repository-pinned binary directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
const binaries=process.env.PG_BIN_DIR;
if (!binaries) throw new Error('Set PG_BIN_DIR to verified PostgreSQL binaries');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pr62-exclusive-db-'));
const cluster=path.join(root,'cluster'), passwordFile=path.join(root,'password');
const password=crypto.randomBytes(32).toString('hex');
fs.writeFileSync(passwordFile,password,{mode:0o600});
let started=false, app;
try {
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 execFileSync(path.join(binaries,'initdb'),['-D',cluster,'-U','synthetic_ui','-A','scram-sha-256','--pwfile',passwordFile,'--no-locale','--encoding=UTF8'],{stdio:'pipe'});
 fs.appendFileSync(path.join(cluster,'postgresql.conf'),`\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\nmax_connections = 40\n`);
 try { execFileSync(path.join(binaries,'pg_ctl'),['-D',cluster,'-l',path.join(root,'postgres.log'),'-w','start'],{stdio:'pipe'}); }
 catch(error){try{console.error(fs.readFileSync(path.join(root,'postgres.log'),'utf8'));}catch{}throw error;}
 started=true;
 const env={...process.env,TMPDIR:fs.realpathSync(os.tmpdir()),DATABASE_URL:`postgresql://synthetic_ui:${password}@127.0.0.1:${port}/postgres`,RUN_DB_TESTS:'1',NEXT_TELEMETRY_DISABLED:'1'};
 execFileSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/desktop-upgrade-restore-db.test.ts','tests/desktop-store-db.test.ts'],{env,stdio:'inherit'});
 console.log('PASS upgrade/restore validation on exclusive disposable PostgreSQL; no existing database used');

} finally {
 if(app && app.exitCode===null){app.kill('SIGTERM');await new Promise(resolve=>app.once('exit',resolve));}
 if(started)execFileSync(path.join(binaries,'pg_ctl'),['-D',cluster,'-m','fast','-w','stop'],{stdio:'pipe'});
 fs.rmSync(root,{recursive:true,force:true});
}
