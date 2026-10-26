// Real UpdatePanel in existing Chromium; synthetic API replies, no GitHub traffic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=process.cwd(), source=process.env.PANEL_SOURCE??path.join(root,'components/desktop/update-panel.tsx');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'update-panel-qa-'));
let server,browser,failed=0;
try {
 await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UpdatePanel} from ${JSON.stringify(source)};createRoot(document.getElementById('root')).render(<UpdatePanel installedVersion="0.1.0"/>);`,resolveDir:root,loader:'tsx'},outfile:path.join(temp,'ui.js'),bundle:true,jsx:'automatic',platform:'browser',plugins:[{name:'local-alias',setup(b){b.onResolve({filter:/^@\//},args=>({path:path.join(root,args.path.slice(2))+'.ts'}));b.onResolve({filter:/^(react|react-dom)(\/.*)?$/},args=>({path:require.resolve(args.path)}));}}]});
 server=http.createServer(async(req,res)=>{res.setHeader('content-type',req.url==='/ui.js'?'application/javascript':'text/html');res.end(req.url==='/ui.js'?await fs.readFile(path.join(temp,'ui.js')):'<!doctype html><html lang="pt-BR"><title>LawyerMind — QA sintética de versões</title><h1>QA sintética: respostas fora de ordem</h1><div id="root"></div><script src="/ui.js"></script></html>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true});
 for(const lateFailure of [false,true]) {
  const page=await browser.newPage(),pending=[],errors=[];
  await page.addInitScript(()=>{window.completedUpdateResponses=0;const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(!response.ok){window.completedUpdateResponses++;return response;}const json=response.json.bind(response);response.json=async()=>{const value=await json();window.completedUpdateResponses++;return value;};return response;};});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/desktop/updates',route=>pending.push(route));
  const wait=async n=>{for(let i=0;i<100&&pending.length<n;i++)await new Promise(r=>setTimeout(r,10));assert.equal(pending.length,n);};
  const reply=async(i,status,message)=>pending[i].fulfill({status,contentType:'application/json',body:JSON.stringify({status:'no-release',installedVersion:'0.1.0',checkedAt:null,lastSuccessfulAt:null,nextCheckAt:null,message})});
  try {
   await page.goto(`http://127.0.0.1:${server.address().port}`);await wait(1);
   await page.getByRole('button',{name:'Consultar releases públicas'}).click();await wait(2);
   await reply(1,200,'Consulta atual: nenhuma release estável.');
   await page.getByRole('status').filter({hasText:'Consulta atual'}).waitFor();
   await reply(0,lateFailure?500:200,'Histórico antigo: ainda não consultado.');
   await page.waitForFunction(()=>window.completedUpdateResponses===2);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.match(await page.getByRole('status').innerText(),/Consulta atual/);
   assert.equal(await page.getByRole('alert').count(),0);
   assert.equal(await page.getByRole('button',{name:'Consultar releases públicas'}).isEnabled(),true);
   assert.deepEqual(errors,[]);
   if(process.env.QA_SCREENSHOT&&!lateFailure)await page.screenshot({path:process.env.QA_SCREENSHOT,fullPage:true});
   console.log(`PASS late history ${lateFailure?'error':'success'}; zero browser errors`);
  }catch(e){failed++;console.log(`FAIL late history ${lateFailure?'error':'success'}: ${e.message}`);}
  finally{await page.close();}
 }
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true});}
process.exitCode=failed?1:0;
