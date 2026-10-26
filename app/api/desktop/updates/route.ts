import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { DesktopError, desktopStateDir, isDesktop } from "@/lib/desktop/env";
import { ensureContainedDir, realDir } from "@/lib/desktop/paths";
import { releaseChecker } from "@/lib/desktop/release-state";
import { downloadVerifiedPackage } from "@/lib/desktop/update-download";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }).strict(),
  // The confirmation names the exact release and package hash the user saw.
  z.object({ action: z.literal("download"), confirm: z.literal(true), version: z.string().max(128), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
let downloading = false;

export async function GET(){try{if(!isDesktop())throw new DesktopError("Not found",404);await sessionMember();return ok(releaseChecker().current());}catch(e){return failure(e);}}
export async function POST(request:Request){
  try{
    const body=await desktopJson(request,input);await sessionMember();
    if(body.action==="check")return ok(await releaseChecker().check());
    const state=releaseChecker().current(),pkg=state.package;
    if(state.status!=="update-available"||!pkg||state.latestVersion!==body.version||pkg.sha256!==body.sha256)throw new DesktopError("A confirmação não corresponde ao pacote da consulta atual. Consulte as releases novamente.",409,"stale-confirmation");
    if(downloading)throw new DesktopError("Já há um download em andamento.",409,"busy");
    downloading=true;
    try{
      const stagingRoot=ensureContainedDir(realDir(desktopStateDir()),"updates");
      // MBLZ_UPDATER_PUBLIC_KEY is a minisign public key (not a secret). Without it nothing is downloaded.
      return ok(await downloadVerifiedPackage({pkg,tag:state.latestVersion!,publicKey:process.env.MBLZ_UPDATER_PUBLIC_KEY,stagingRoot}),201);
    }finally{downloading=false;}
  }catch(e){return failure(e);}
}
