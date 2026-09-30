import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { buildAgentContext } from "@/lib/agent/context";
import { runOpenClawTurn } from "@/lib/agent/openclaw";

export type AgentChannel="WEB"|"EMAIL"|"TELEGRAM"|"WHATSAPP";

export async function respondWithAgent(args:{
  userId:string;
  workspaceId:string;
  channel:AgentChannel;
  threadId:string;
  message:string;
}){
  const member=await requireActiveMembership(args.userId,args.workspaceId);
  const viewer=await requirePermission(args.userId,member.workspaceId,P.AGENT_USE);
  const connection=await prisma.openClawConnection.findUnique({where:{workspaceId:member.workspaceId}});
  if(!connection||connection.status!=="CONNECTED"){
    const error=new Error("O agente MBLZ ainda não está conectado ao OpenClaw.");
    (error as Error&{status?:number}).status=503;
    throw error;
  }

  const sessionKey="mblz-"+sha256([member.workspaceId,args.userId,args.channel,args.threadId].join(":"));
  const conversation=await prisma.agentConversation.upsert({
    where:{workspaceId_userId_channel_externalThreadId:{
      workspaceId:member.workspaceId,userId:args.userId,channel:args.channel,externalThreadId:args.threadId,
    }},
    create:{
      workspaceId:member.workspaceId,userId:args.userId,openClawConnectionId:connection.id,
      channel:args.channel,externalThreadId:args.threadId,sessionKey,lastMessageAt:new Date(),
    },
    update:{openClawConnectionId:connection.id,sessionKey,lastMessageAt:new Date(),status:"ACTIVE"},
  });

  const context=await buildAgentContext(viewer,member.workspace.timezone);
  const response=await runOpenClawTurn({
    connection,conversationId:conversation.id,channel:args.channel,message:args.message,context,
  });

  await prisma.activityLog.create({data:{
    workspaceId:member.workspaceId,userId:args.userId,type:"AGENT_TURN",
    entityType:"AgentConversation",entityId:conversation.id,
    summary:`Agente MBLZ respondeu via ${args.channel}`,source:"OPENCLAW",
    metadata:{channel:args.channel,requestHash:sha256(args.message),responseHash:sha256(response.text),usage:response.usage},
  }});
  return {conversationId:conversation.id,text:response.text};
}
