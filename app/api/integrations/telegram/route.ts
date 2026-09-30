import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { inspectTelegramBot, newTelegramWebhookSecret, registerTelegramWebhook, removeTelegramWebhook } from "@/lib/agent/telegram";

const input=z.object({
  workspaceId:z.string().optional(),
  botToken:z.string().trim().min(30).max(256),
});

function appUrl(){
  const raw=process.env.NEXT_PUBLIC_APP_URL;
  if(!raw)throw new Error("NEXT_PUBLIC_APP_URL não configurado.");
  const url=new URL(raw);
  if(url.protocol!=="https:" && process.env.NODE_ENV==="production")throw new Error("O domínio público do MBLZ deve usar HTTPS.");
  return url.toString().replace(/\/$/,"");
}

export async function GET(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const member=await requireActiveMembership(session.user.id,request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_USE);
    const connection=await prisma.agentChannelConnection.findUnique({
      where:{workspaceId_channel_accountKey:{workspaceId:member.workspaceId,channel:"TELEGRAM",accountKey:"workspace-bot"}},
      select:{id:true,displayName:true,status:true,externalIdentity:true,connectedAt:true,revokedAt:true,config:true},
    });
    return NextResponse.json({connection});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}

export async function POST(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const parsed=input.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_MANAGE);

    const bot=await inspectTelegramBot(parsed.botToken);
    const previous=await prisma.agentChannelConnection.findUnique({
      where:{workspaceId_channel_accountKey:{workspaceId:member.workspaceId,channel:"TELEGRAM",accountKey:"workspace-bot"}},
      select:{id:true,externalIdentity:true},
    });
    const botChanged=Boolean(previous?.externalIdentity&&previous.externalIdentity!==bot.username);
    const webhookSecret=newTelegramWebhookSecret();
    const connection=await prisma.agentChannelConnection.upsert({
      where:{workspaceId_channel_accountKey:{workspaceId:member.workspaceId,channel:"TELEGRAM",accountKey:"workspace-bot"}},
      create:{
        workspaceId:member.workspaceId,userId:null,channel:"TELEGRAM",accountKey:"workspace-bot",
        displayName:"@"+bot.username,status:"PENDING",secretEnc:encryptSecret(parsed.botToken),
        webhookSecretEnc:encryptSecret(webhookSecret),externalIdentity:bot.username,
        config:{botId:bot.id,username:bot.username,name:bot.name},revokedAt:null,
      },
      update:{
        displayName:"@"+bot.username,status:"PENDING",secretEnc:encryptSecret(parsed.botToken),
        webhookSecretEnc:encryptSecret(webhookSecret),externalIdentity:bot.username,
        config:{botId:bot.id,username:bot.username,name:bot.name},revokedAt:null,
      },
    });

    try{
      await registerTelegramWebhook({
        botToken:parsed.botToken,
        webhookUrl:appUrl()+"/api/webhooks/telegram/"+connection.id,
        secret:webhookSecret,
      });
    }catch(error){
      await prisma.agentChannelConnection.update({
        where:{id:connection.id},
        data:{status:"ERROR",config:{botId:bot.id,username:bot.username,name:bot.name,lastError:error instanceof Error?error.message:"Webhook error"}},
      });
      throw error;
    }

    const now=new Date();
    const operations=[
      prisma.agentChannelConnection.update({where:{id:connection.id},data:{status:"CONNECTED",connectedAt:now}}),
      ...(botChanged?[
        prisma.agentExternalIdentity.updateMany({
          where:{channelConnectionId:connection.id,status:{not:"REVOKED"}},
          data:{status:"REVOKED",revokedAt:now,externalUserId:null,externalChatId:null,pairingCodeHash:null,pairingExpiresAt:null},
        }),
        prisma.agentChannelPreference.updateMany({
          where:{workspaceId:member.workspaceId,channel:"TELEGRAM"},
          data:{enabled:false},
        }),
      ]:[]),
      prisma.auditLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,action:"TELEGRAM_BOT_CONNECTED",
        entityType:"AgentChannelConnection",entityId:connection.id,
        metadata:{username:bot.username,botId:bot.id,botChanged},
      }}),
    ];
    await prisma.$transaction(operations);

    return NextResponse.json({connection:{id:connection.id,displayName:"@"+bot.username,status:"CONNECTED",externalIdentity:bot.username,connectedAt:now}});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível conectar o Telegram."},{status});
  }
}

export async function DELETE(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const body=await request.json().catch(()=>({}));
    const workspaceId=typeof body?.workspaceId==="string"?body.workspaceId:undefined;
    const member=await requireActiveMembership(session.user.id,workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_MANAGE);
    const connection=await prisma.agentChannelConnection.findUnique({
      where:{workspaceId_channel_accountKey:{workspaceId:member.workspaceId,channel:"TELEGRAM",accountKey:"workspace-bot"}},
    });
    if(!connection)return NextResponse.json({ok:true});

    if(connection.secretEnc){
      try{await removeTelegramWebhook(connection);}catch{/* revocation continues even when Telegram is unavailable */}
    }

    await prisma.$transaction([
      prisma.agentExternalIdentity.updateMany({
        where:{channelConnectionId:connection.id,status:{not:"REVOKED"}},
        data:{status:"REVOKED",revokedAt:new Date(),externalUserId:null,externalChatId:null,pairingCodeHash:null,pairingExpiresAt:null},
      }),
      prisma.agentChannelPreference.updateMany({
        where:{workspaceId:member.workspaceId,channel:"TELEGRAM"},
        data:{enabled:false},
      }),
      prisma.agentChannelConnection.update({
        where:{id:connection.id},
        data:{status:"REVOKED",secretEnc:null,webhookSecretEnc:null,revokedAt:new Date()},
      }),
      prisma.auditLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,action:"TELEGRAM_BOT_DISCONNECTED",
        entityType:"AgentChannelConnection",entityId:connection.id,
      }}),
    ]);
    return NextResponse.json({ok:true});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível desconectar o Telegram."},{status});
  }
}
