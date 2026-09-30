import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { requireActiveMembership } from "@/lib/workspace/context";
import { respondWithAgent } from "@/lib/agent/service";

const input=z.object({
  workspaceId:z.string().optional(),
  channel:z.enum(["WEB","EMAIL","TELEGRAM","WHATSAPP"]).default("WEB"),
  threadId:z.string().trim().min(1).max(240).default("main"),
  message:z.string().trim().min(1).max(12000),
});

export async function POST(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const parsed=input.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    const response=await respondWithAgent({
      userId:session.user.id,
      workspaceId:member.workspaceId,
      channel:parsed.channel,
      threadId:parsed.threadId,
      message:parsed.message,
    });
    return NextResponse.json(response);
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar o agente."},{status});
  }
}
