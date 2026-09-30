import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { newTelegramPairingCode } from "@/lib/agent/telegram";

async function getConnection(workspaceId:string){
  return prisma.agentChannelConnection.findUnique({
    where:{workspaceId_channel_accountKey:{workspaceId,channel:"TELEGRAM",accountKey:"workspace-bot"}},
  });
}

export async function POST(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const body=await request.json().catch(()=>({}));
    const workspaceId=typeof body?.workspaceId==="string"?body.workspaceId:undefined;
    const member=await requireActiveMembership(session.user.id,workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_USE);

    const connection=await getConnection(member.workspaceId);
    if(!connection||connection.status!=="CONNECTED"||!connection.externalIdentity){
      return NextResponse.json({error:"O bot Telegram do escritório ainda não está conectado."},{status:503});
    }
    const existing=await prisma.agentExternalIdentity.findUnique({
      where:{channelConnectionId_userId:{channelConnectionId:connection.id,userId:session.user.id}},
    });
    if(existing?.status==="VERIFIED"&&existing.externalChatId){
      return NextResponse.json({paired:true,displayName:existing.displayName,verifiedAt:existing.verifiedAt});
    }

    const code=newTelegramPairingCode();
    const expiresAt=new Date(Date.now()+15*60*1000);
    await prisma.agentExternalIdentity.upsert({
      where:{channelConnectionId_userId:{channelConnectionId:connection.id,userId:session.user.id}},
      create:{
        workspaceId:member.workspaceId,userId:session.user.id,channelConnectionId:connection.id,channel:"TELEGRAM",
        status:"PENDING",pairingCodeHash:sha256(code),pairingExpiresAt:expiresAt,
      },
      update:{
        status:"PENDING",pairingCodeHash:sha256(code),pairingExpiresAt:expiresAt,
        revokedAt:null,externalUserId:null,externalChatId:null,displayName:null,verifiedAt:null,
      },
    });
    const username=connection.externalIdentity.replace(/^@/,"");
    return NextResponse.json({
      paired:false,
      expiresAt,
      deepLink:`https://t.me/${username}?start=${encodeURIComponent(code)}`,
    });
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível iniciar o pareamento."},{status});
  }
}

export async function DELETE(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const body=await request.json().catch(()=>({}));
    const workspaceId=typeof body?.workspaceId==="string"?body.workspaceId:undefined;
    const member=await requireActiveMembership(session.user.id,workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_USE);
    const connection=await getConnection(member.workspaceId);
    if(!connection)return NextResponse.json({ok:true});

    const identity=await prisma.agentExternalIdentity.findUnique({
      where:{channelConnectionId_userId:{channelConnectionId:connection.id,userId:session.user.id}},
    });
    if(identity){
      await prisma.$transaction([
        prisma.agentExternalIdentity.update({
          where:{id:identity.id},
          data:{status:"REVOKED",revokedAt:new Date(),externalUserId:null,externalChatId:null,pairingCodeHash:null,pairingExpiresAt:null},
        }),
        prisma.agentChannelPreference.upsert({
          where:{workspaceId_userId_channel:{workspaceId:member.workspaceId,userId:session.user.id,channel:"TELEGRAM"}},
          create:{workspaceId:member.workspaceId,userId:session.user.id,channel:"TELEGRAM",enabled:false,mode:"ASSIST"},
          update:{enabled:false},
        }),
        prisma.auditLog.create({data:{
          workspaceId:member.workspaceId,userId:session.user.id,action:"TELEGRAM_USER_UNPAIRED",
          entityType:"AgentExternalIdentity",entityId:identity.id,
        }}),
      ]);
    }
    return NextResponse.json({ok:true});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível remover o pareamento."},{status});
  }
}
