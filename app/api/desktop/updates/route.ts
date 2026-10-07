import { z } from "zod";
import { desktopJson, failure, ok, sessionMember } from "@/lib/desktop/http";
import { DesktopError, isDesktop } from "@/lib/desktop/env";
import { releaseChecker } from "@/lib/desktop/release-state";
export async function GET(){try{if(!isDesktop())throw new DesktopError("Not found",404);await sessionMember();return ok(releaseChecker().current());}catch(e){return failure(e);}}
export async function POST(request:Request){try{await desktopJson(request,z.object({action:z.literal("check")}).strict());await sessionMember();return ok(await releaseChecker().check());}catch(e){return failure(e);}}
