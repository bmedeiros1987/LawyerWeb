import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { buildAgentContext } from "@/lib/agent/context";
import { runOpenClawTurn } from "@/lib/agent/openclaw";

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
    const viewer=await requirePermission(session.user.id,member.workspaceId,P.AGENT_USE);
    const connection=await prisma.openClawConnection.findUnique({where:{workspaceId:member.workspaceId}});
    if(!connection||connection.status!=="CONNECTED")return NextResponse.json({error:"O agente MBLZ ainda não está conectado ao OpenClaw."},{status:503});

    const sessionKey="mblz-"+sha256([member.workspaceId,session.user.id,parsed.channel,parsed.threadId].join(":"));
    const conversation=await prisma.agentConversation.upsert({
      where:{workspaceId_userId_channel_externalThreadId:{workspaceId:member.workspaceId,userId:session.user.id,channel:parsed.channel,externalThreadId:parsed.threadId}},
      create:{
        workspaceId:member.workspaceId,userId:session.user.id,openClawConnectionId:connection.id,
        channel:parsed.channel,externalThreadId:parsed.threadId,sessionKey,lastMessageAt:new Date(),
      },
      update:{openClawConnectionId:connection.id,sessionKey,lastMessageAt:new Date(),status:"ACTIVE"},
    });

    const context=await buildAgentContext(viewer,member.workspace.timezone);
    const response=await runOpenClawTurn({connection,conversationId:conversation.id,channel:parsed.channel,message:parsed.message,context});

    await prisma.activityLog.create({data:{
      workspaceId:member.workspaceId,userId:session.user.id,type:"AGENT_TURN",
      entityType:"AgentConversation",entityId:conversation.id,summary:`Agente MBLZ respondeu via ${parsed.channel}`,
      source:"OPENCLAW",metadata:{channel:parsed.channel,requestHash:sha256(parsed.message),responseHash:sha256(response.text),usage:response.usage}
    }});
    return NextResponse.json({conversationId:conversation.id,text:response.text});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível consultar o agente."},{status});
  }
}
