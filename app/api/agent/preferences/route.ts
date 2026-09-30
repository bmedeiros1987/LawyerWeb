import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input=z.object({
  workspaceId:z.string().optional(),
  channel:z.enum(["EMAIL","TELEGRAM","WHATSAPP"]),
  enabled:z.boolean(),
  mode:z.enum(["DRAFT","ASSIST"]).default("DRAFT"),
});

export async function GET(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const member=await requireActiveMembership(session.user.id,request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_USE);
    const preferences=await prisma.agentChannelPreference.findMany({where:{workspaceId:member.workspaceId,userId:session.user.id}});
    return NextResponse.json({preferences});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}

export async function PATCH(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const parsed=input.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_USE);
    const preference=await prisma.agentChannelPreference.upsert({
      where:{workspaceId_userId_channel:{workspaceId:member.workspaceId,userId:session.user.id,channel:parsed.channel}},
      create:{workspaceId:member.workspaceId,userId:session.user.id,channel:parsed.channel,enabled:parsed.enabled,mode:parsed.mode},
      update:{enabled:parsed.enabled,mode:parsed.mode},
    });
    await prisma.activityLog.create({data:{
      workspaceId:member.workspaceId,userId:session.user.id,type:"AGENT_CHANNEL_PREFERENCE",
      entityType:"AgentChannelPreference",entityId:preference.id,
      summary:`${parsed.channel} ${parsed.enabled?"ativado":"desativado"} para o agente MBLZ`,
      source:"SYSTEM",metadata:{channel:parsed.channel,enabled:parsed.enabled,mode:parsed.mode}
    }});
    return NextResponse.json({preference});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível salvar a preferência."},{status});
  }
}
