import fs from "node:fs";
import crypto from "node:crypto";
import { desktopStateDir } from "./env";
import { containedPath, openContained, realDir } from "./paths";
import { createReleaseChecker, initialReleaseState, safeReleaseUrl, type ReleaseState } from "./release-check";
const VERSION=process.env.MBLZ_DESKTOP_VERSION??"dev";
function load():ReleaseState {
  try { const root=realDir(desktopStateDir()),{fd,stat}=openContained(root,"release-check.json");let text:string;
    try{if(stat.size>65536)throw Error("cache");text=fs.readFileSync(fd,"utf8");}finally{fs.closeSync(fd);}
    const value=JSON.parse(text) as ReleaseState;
    if(value.installedVersion!==VERSION || !value.lastSuccessfulAt || !Number.isFinite(Date.parse(value.lastSuccessfulAt)) || (value.releaseUrl&&!safeReleaseUrl(value.releaseUrl)))return initialReleaseState(VERSION);
    // Only history is trusted across restarts; remote status is checked anew.
    return {...initialReleaseState(VERSION),lastSuccessfulAt:value.lastSuccessfulAt};
  } catch{return initialReleaseState(VERSION);}
}
function persist(state:ReleaseState) {
  const root=realDir(desktopStateDir());const target=containedPath(root,"release-check.json","any"),tmp=containedPath(root,`.release-check-${crypto.randomUUID()}.json`,"absent");
  try { const fd=fs.openSync(tmp,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);} fs.renameSync(tmp,target); } finally { fs.rmSync(tmp,{force:true}); }
}
let checker:ReturnType<typeof createReleaseChecker>|undefined;
export const releaseChecker=()=>checker??=createReleaseChecker({installedVersion:VERSION,platform:process.platform,initial:load(),persist});
