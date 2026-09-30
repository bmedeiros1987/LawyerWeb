import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { respondWithAgent } from "@/lib/agent/service";
import { sendTelegramMessage, telegramWebhookSecret } from "@/lib/agent/telegram";

type TelegramUpdate={
  update_id?:number;
  message?:{
    message_id?:number;
    text?:string;
    chat?:{id?:number|string;type?:string};
    from?:{id?:number|string;username?:string;first_name?:string;last_name?:string};
  };
};

function safeEqual(a:string,b:string){
  const ah=Buffer.from(sha256(a));
  const bh=Buffer.from(sha256(b));
  return ah.length===bh.length&&crypto.timingSafeEqual(ah,bh);
}

function displayName(from:NonNullable<NonNullable<TelegramUpdate["message"]>["from"]>){
  return [from.first_name,from.last_name].filter(Boolean).join(" ")||from.username||"Telegram";
}

export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
  const {id}=await context.params;
  const connection=await prisma.agentChannelConnection.findFirst({
    where:{id,channel:"TELEGRAM",status:"CONNECTED"},
  });
  if(!connection)return new NextResponse("Not found",{status:404});

  let expected:string;
  try{expected=telegramWebhookSecret(connection);}catch{return new NextResponse("Unavailable",{status:503});}
  const received=request.headers.get("x-telegram-bot-api-secret-token")??"";
  if(!received||!safeEqual(received,expected))return new NextResponse("Unauthorized",{status:401});

  let update:TelegramUpdate;
  try{update=await request.json() as TelegramUpdate;}catch{return new NextResponse("Bad request",{status:400});}
  if(typeof update.update_id!=="number")return NextResponse.json({ok:true});
  const externalEventId=String(update.update_id);

  let event;
  try{
    event=await prisma.agentChannelEvent.create({
      data:{
        workspaceId:connection.workspaceId,channelConnectionId:connection.id,channel:"TELEGRAM",
        externalEventId,status:"RECEIVED",
        metadata:{
          messageId:update.message?.message_id??null,
          chatHash:update.message?.chat?.id!=null?sha256(String(update.message.chat.id)):null,
          fromHash:update.message?.from?.id!=null?sha256(String(update.message.from.id)):null,
          textHash:update.message?.text?sha256(update.message.text):null,
        },
      },
    });
  }catch(error){
    if((error as {code?:string}).code==="P2002")return NextResponse.json({ok:true,duplicate:true});
    return NextResponse.json({ok:true});
  }

  try{
    const message=update.message;
    const text=message?.text?.trim();
    const chatId=message?.chat?.id!=null?String(message.chat.id):null;
    const fromId=message?.from?.id!=null?String(message.from.id):null;
    if(!message||!text||!chatId||!fromId){
      await prisma.agentChannelEvent.update({where:{id:event.id},data:{status:"IGNORED",processedAt:new Date()}});
      return NextResponse.json({ok:true});
    }

    const startMatch=text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{8,80}))?$/i);
    if(startMatch){
      if(message.chat?.type!=="private"){
        await sendTelegramMessage(connection,chatId,"Por segurança, faça o pareamento em uma conversa privada com o bot.");
        await prisma.agentChannelEvent.update({where:{id:event.id},data:{status:"REJECTED",processedAt:new Date(),error:"pairing requires private chat"}});
        return NextResponse.json({ok:true});
      }
      const code=startMatch[1];
      if(!code){
        await sendTelegramMessage(connection,chatId,"Abra o MBLZ e use Integrações → MBLZ Agent → Telegram para gerar seu link de pareamento.");
        await prisma.agentChannelEvent.update({where:{id:event.id},data:{status:"PROCESSED",processedAt:new Date()}});
        return NextResponse.json({ok:true});
      }
      const identity=await prisma.agentExternalIdentity.findFirst({
        where:{
          channelConnectionId:connection.id,channel:"TELEGRAM",status:"PENDING",
          pairingCodeHash:sha256(code),pairingExpiresAt:{gt:new Date()},
        },
      });
      if(!identity){
        await sendTelegramMessage(connection,chatId,"Esse link de pareamento expirou ou já foi utilizado. Gere um novo link dentro do MBLZ.");
        await prisma.agentChannelEvent.update({where:{id:event.id},data:{status:"PROCESSED",processedAt:new Date()}});
        return NextResponse.json({ok:true});
      }

      const other=await prisma.agentExternalIdentity.findFirst({
        where:{channelConnectionId:connection.id,externalUserId:fromId,status:"VERIFIED",id:{not:identity.id}},
      });
      if(other){
        await sendTelegramMessage(connection,chatId,"Esta conta do Telegram já está vinculada a outro usuário deste workspace. Remova o vínculo anterior pelo MBLZ.");
        await prisma.agentChannelEvent.update({where:{id:event.id},data:{status:"REJECTED",processedAt:new Date(),error:"external identity already paired"}});
        return NextResponse.json({ok:true});
      }

      const name=message.from?displayName(message.from):"Telegram";
      await prisma.$transaction([
        prisma.agentExternalIdentity.update({
          where:{id:identity.id},
          data:{
            externalUserId:fromId,externalChatId:chatId,displayName:name,status:"VERIFIED",
            verifiedAt:new Date(),revokedAt:null,pairingCodeHash:null,pairingExpiresAt:null,
          },
        }),
        prisma.agentChannelPreference.upsert({
          where:{workspaceId_userId_channel:{workspaceId:connection.workspaceId,userId:identity.userId,channel:"TELEGRAM"}},
          create:{workspaceId:connection.workspaceId,userId:identity.userId,channel:"TELEGRAM",enabled:true,mode:"ASSIST"},
          update:{enabled:true,mode:"ASSIST"},
        }),
        prisma.agentChannelEvent.update({
          where:{id:event.id},data:{userId:identity.userId,status:"PROCESSED",processedAt:new Date()},
        }),
        prisma.auditLog.create({data:{
          workspaceId:connection.workspaceId,userId:identity.userId,action:"TELEGRAM_USER_PAIRED",
          entityType:"AgentExternalIdentity",entityId:identity.id,
          metadata:{telegramUserHash:sha256(fromId),telegramChatHash:sha256(chatId)},
        }}),
      ]);
      await sendTelegramMessage(connection,chatId,`Telegram conectado ao MBLZ para ${name}. A partir de agora você pode conversar com o agente por aqui. Para desativar, use Integrações no MBLZ.`);
      return NextResponse.json({ok:true,paired:true});
    }

    const identity=await prisma.agentExternalIdentity.findFirst({
      where:{
        channelConnectionId:connection.id,channel:"TELEGRAM",status:"VERIFIED",
        externalUserId:fromId,externalChatId:chatId,
      },
    });
    if(!identity){
      await sendTelegramMessage(connection,chatId,"Este Telegram ainda não está vinculado ao MBLZ. Gere seu link de pareamento em Integrações → MBLZ Agent.");
      await prisma.agentChannelEvent.update({where:{id:event.id},data:{status:"REJECTED",processedAt:new Date(),error:"unpaired identity"}});
      return NextResponse.json({ok:true});
    }

    const preference=await prisma.agentChannelPreference.findUnique({
      where:{workspaceId_userId_channel:{workspaceId:connection.workspaceId,userId:identity.userId,channel:"TELEGRAM"}},
    });
    if(!preference?.enabled){
      await sendTelegramMessage(connection,chatId,"O canal Telegram do agente está desativado no MBLZ. Reative em Integrações.");
      await prisma.agentChannelEvent.update({where:{id:event.id},data:{userId:identity.userId,status:"REJECTED",processedAt:new Date(),error:"channel disabled"}});
      return NextResponse.json({ok:true});
    }

    const answer=await respondWithAgent({
      userId:identity.userId,workspaceId:connection.workspaceId,channel:"TELEGRAM",
      threadId:"telegram:"+chatId,message:text,
    });
    await sendTelegramMessage(connection,chatId,answer.text);
    await prisma.agentChannelEvent.update({where:{id:event.id},data:{userId:identity.userId,status:"PROCESSED",processedAt:new Date()}});
    return NextResponse.json({ok:true});
  }catch(error){
    const message=error instanceof Error?error.message:"telegram processing failed";
    await prisma.agentChannelEvent.update({
      where:{id:event.id},data:{status:"FAILED",processedAt:new Date(),error:message.slice(0,2000)},
    }).catch(()=>null);
    const chatId=update.message?.chat?.id!=null?String(update.message.chat.id):null;
    if(chatId)await sendTelegramMessage(connection,chatId,"O agente MBLZ está temporariamente indisponível. Tente novamente em instantes.").catch(()=>null);
    return NextResponse.json({ok:true});
  }
}
