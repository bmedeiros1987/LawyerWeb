export const RELEASE_URL = "https://api.github.com/repos/bmedeiros1987/LawyerWeb/releases?per_page=20";
export const REPOSITORY_URL = "https://github.com/bmedeiros1987/LawyerWeb";
export type ReleaseState = { status: "not-checked" | "no-release" | "current" | "update-available" | "platform-unavailable" | "unknown-installed" | "offline" | "error" | "rate-limited"; installedVersion: string; checkedAt: string | null; lastSuccessfulAt: string | null; nextCheckAt: string | null; latestVersion?: string; releaseUrl?: string; notes?: string; message: string; cached?: boolean };
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
async function boundedJson(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0); if (declared > 262144) throw Error("Resposta muito grande.");
  if (!response.body) throw Error("Resposta vazia inválida.");
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let total=0;
  try { for (;;) { const {done,value}=await reader.read(); if(done)break; total+=value.byteLength; if(total>262144)throw Error("Resposta muito grande.");chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  const all=new Uint8Array(total);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;} return JSON.parse(new TextDecoder().decode(all));
}
export function createReleaseChecker(input: { installedVersion: string; platform: string; fetcher?: typeof fetch; now?: () => number; initial?: ReleaseState; persist?: (state: ReleaseState) => void }) {
  const fetcher=input.fetcher??fetch, now=input.now??Date.now; let state=input.initial??initialReleaseState(input.installedVersion), flight:Promise<ReleaseState>|null=null;
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
          const supported=release.assets.some((a:unknown)=>{ if(!a||typeof a!=="object"||typeof (a as {name?:unknown}).name!=="string")return false;const name=(a as {name:string}).name;return input.platform==="darwin"?/\.dmg$/i.test(name):input.platform==="win32"?/\.exe$/i.test(name):input.platform==="linux"?/\.(deb|AppImage)$/i.test(name):false; });
          const status=!installed?"unknown-installed":compare(latest,installed)<=0?"current":supported?"update-available":"platform-unavailable";
          result={...success,status,latestVersion:release.tag_name,releaseUrl:url,notes:typeof release.body==="string"?release.body.slice(0,16000):"",message:status==="current"?"A versão instalada é igual ou posterior à última release estável.":status==="unknown-installed"?"A versão instalada não possui SemVer estável; comparação indisponível.":status==="platform-unavailable"?"Há uma release mais recente, sem pacote identificado para esta plataforma.":"Há uma release estável mais recente. Instalação ainda indisponível."};
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
