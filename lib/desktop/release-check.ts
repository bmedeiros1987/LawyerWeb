import { MANIFEST_ASSET, packageFor, packageUrlFor, parseManifest, updateTarget, type UpdatePackage } from "./update-manifest";
export const RELEASE_URL = "https://api.github.com/repos/bmedeiros1987/LawyerWeb/releases?per_page=20";
export const REPOSITORY_URL = "https://github.com/bmedeiros1987/LawyerWeb";
export type ReleaseState = { status: "not-checked" | "no-release" | "current" | "update-available" | "platform-unavailable" | "release-unverified" | "incompatible" | "unknown-installed" | "offline" | "error" | "rate-limited"; installedVersion: string; checkedAt: string | null; lastSuccessfulAt: string | null; nextCheckAt: string | null; latestVersion?: string; releaseUrl?: string; notes?: string; message: string; cached?: boolean; target?: string; package?: UpdatePackage };
export function semver(value: unknown): number[] | null {
  if (typeof value !== "string" || value.length > 128) return null;
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[a-zA-Z0-9.-]+)?$/.exec(value);
  if (!m) return null; const result = m.slice(1,4).map(Number); return result.every(Number.isSafeInteger) ? result : null;
}
const compare = (a: number[], b: number[]) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2];
export function safeReleaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "github.com" && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/bmedeiros1987\/LawyerWeb\/releases\/tag\/[^/]+$/.test(u.pathname) ? u.toString() : null; } catch { return null; }
}
export function initialReleaseState(installedVersion: string): ReleaseState { return { status: "not-checked", installedVersion, checkedAt:null, lastSuccessfulAt:null, nextCheckAt:null, message:"Ainda não consultado. Instalação de atualizações indisponível." }; }
async function boundedJson(response: Response, limit = 262144) {
  const declared = Number(response.headers.get("content-length") ?? 0); if (declared > limit) throw Error("Resposta muito grande.");
  if (!response.body) throw Error("Resposta vazia inválida.");
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let total=0;
  try { for (;;) { const {done,value}=await reader.read(); if(done)break; total+=value.byteLength; if(total>limit)throw Error("Resposta muito grande.");chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  const all=new Uint8Array(total);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;} return JSON.parse(new TextDecoder().decode(all));
}
type Candidate = { tag_name: string; body?: unknown; assets: unknown[] };
type Evaluation = { status: ReleaseState["status"]; message: string; notes?: string; package?: UpdatePackage };
const trustedAssetHost = (url: string) => { try { const u = new URL(url); return u.protocol === "https:" && (u.hostname === "github.com" || u.hostname.endsWith(".githubusercontent.com")); } catch { return false; } };
export function createReleaseChecker(input: { installedVersion: string; platform: string; arch?: string; fetcher?: typeof fetch; now?: () => number; initial?: ReleaseState; persist?: (state: ReleaseState) => void }) {
  const fetcher=input.fetcher??fetch, now=input.now??Date.now; let state=input.initial??initialReleaseState(input.installedVersion), flight:Promise<ReleaseState>|null=null;
  const evaluateRelease=async(release:Candidate,target:ReturnType<typeof updateTarget>,installed:number[],signal:AbortSignal):Promise<Evaluation>=>{
    const tag=release.tag_name,arch=input.arch??process.arch;
    if(!target)return {status:"platform-unavailable",message:`Não há pacote de atualização para ${input.platform}/${arch}.`};
    const named=(name:string)=>release.assets.find((a):a is {name:string;size?:unknown;browser_download_url?:unknown}=>Boolean(a)&&typeof a==="object"&&(a as {name?:unknown}).name===name);
    const asset=named(MANIFEST_ASSET);
    if(!asset)return {status:"release-unverified",message:"Há uma release mais recente, mas sem manifesto de atualização (versão, link, SHA-256, assinatura e compatibilidade). Nenhuma atualização é oferecida."};
    const manifestUrl=packageUrlFor(tag,MANIFEST_ASSET);
    if(asset.browser_download_url!==manifestUrl)throw Error("Link do manifesto inválido.");
    const response=await fetcher(manifestUrl,{headers:{Accept:"application/octet-stream","User-Agent":"LawyerMind-public-release-check"},redirect:"follow",signal,cache:"no-store"});
    if(response.url&&!trustedAssetHost(response.url))throw Error("Destino inesperado.");
    if(!response.ok)throw Error(`GitHub respondeu HTTP ${response.status} ao ler o manifesto.`);
    let manifest;try{manifest=parseManifest(await boundedJson(response,65536),tag);}catch(e){return {status:"release-unverified",message:"Manifesto de atualização inválido: "+(e instanceof Error?e.message:"formato inesperado")+" Nenhuma atualização é oferecida."};}
    if(compare(installed,semver(manifest.minimumInstalledVersion)!)<0)return {status:"incompatible",message:`Esta versão só pode ser atualizada a partir de ${manifest.minimumInstalledVersion}. Atualize antes para uma versão intermediária.`};
    const pkg=packageFor(manifest,target);
    if(!pkg)return {status:"platform-unavailable",message:`O manifesto não traz pacote para ${target}.`};
    const listed=named(pkg.name);
    if(!listed||listed.size!==pkg.size||listed.browser_download_url!==pkg.url)return {status:"release-unverified",message:"O pacote do manifesto não corresponde aos arquivos publicados na release. Nenhuma atualização é oferecida."};
    const notes=(manifest.notes.trim()||(typeof release.body==="string"?release.body.trim():"")).slice(0,16000);
    if(!notes)return {status:"release-unverified",message:"Release sem notas de alteração (changelog). Nenhuma atualização é oferecida."};
    return {status:"update-available",notes,package:pkg,message:`Há uma release estável com pacote para ${target}, com SHA-256 e assinatura declarados. Hash e assinatura só são conferidos ao baixar; nada é instalado automaticamente.`};
  };
  const query=async():Promise<ReleaseState>=>{
    const checked=now(),last=state.lastSuccessfulAt;const base={installedVersion:input.installedVersion,checkedAt:new Date(checked).toISOString(),lastSuccessfulAt:last,nextCheckAt:new Date(checked+5*60_000).toISOString()};
    let result:ReleaseState;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try {
      const response=await fetcher(RELEASE_URL,{headers:{Accept:"application/vnd.github+json","User-Agent":"LawyerMind-public-release-check"},redirect:"error",signal:controller.signal,cache:"no-store"});
      if(response.url&&response.url!==RELEASE_URL)throw Error("Destino inesperado.");
      if(response.status===429 || (response.status===403&&response.headers.get("x-ratelimit-remaining")==="0")) result={...base,status:"rate-limited",message:"GitHub limitou as consultas. Tente novamente após o intervalo."};
      else {
        if(!response.ok)throw Error(`GitHub respondeu HTTP ${response.status}.`);
        const data=await boundedJson(response);if(!Array.isArray(data)||data.length>20)throw Error("Resposta de releases inválida.");
        const releases=data.filter((r:unknown)=>{
          if(!r||typeof r!=="object")throw Error("Release malformada.");
          const v=r as Record<string,unknown>;
          if(typeof v.tag_name!=="string"||typeof v.draft!=="boolean"||typeof v.prerelease!=="boolean"||!Array.isArray(v.assets))throw Error("Release malformada.");
          return !v.draft&&!v.prerelease&&semver(v.tag_name);
        }).sort((a,b)=>compare(semver(b.tag_name)!,semver(a.tag_name)!));
        const success={...base,lastSuccessfulAt:base.checkedAt,nextCheckAt:new Date(checked+15*60_000).toISOString()};
        if(!releases.length)result={...success,status:"no-release",message:"Nenhuma versão estável publicada. Artefatos de CI não são releases."};
        else {
          const release=releases[0],url=safeReleaseUrl(release.html_url);if(!url)throw Error("Link de release inválido.");
          const installed=semver(input.installedVersion),latest=semver(release.tag_name)!;
          const target=updateTarget(input.platform,input.arch??process.arch);
          const evaluated=!installed||compare(latest,installed)<=0?null:await evaluateRelease(release,target,installed,controller.signal);
          const status=!installed?"unknown-installed":compare(latest,installed)<=0?"current":evaluated!.status;
          result={...success,status,latestVersion:release.tag_name,releaseUrl:url,notes:evaluated?.notes??(typeof release.body==="string"?release.body.slice(0,16000):""),...(evaluated?.package?{target:evaluated.package.target,package:evaluated.package}:{}),message:status==="current"?"A versão instalada é igual ou posterior à última release estável.":status==="unknown-installed"?"A versão instalada não possui SemVer estável; comparação indisponível.":evaluated!.message};
        }
      }
    } catch(error) {
      const offline=error instanceof TypeError;result={...base,status:offline?"offline":"error",message:offline?"Sem conexão com o GitHub. Isso não confirma que o app está atualizado.":controller.signal.aborted?"A consulta excedeu o tempo limite.":error instanceof Error?error.message:"Falha na consulta."};
    } finally{clearTimeout(timer);}
    state=result;try{input.persist?.(state);}catch{state={...state,message:state.message+" Histórico local não pôde ser gravado."};} return {...state};
  };
  return { current:()=>({...state}),check:():Promise<ReleaseState>=>{
    if(flight)return flight;
    if(state.nextCheckAt&&Date.parse(state.nextCheckAt)>now())return Promise.resolve({...state,cached:true});
    flight=query().finally(()=>{flight=null;});return flight;
  } };
}
