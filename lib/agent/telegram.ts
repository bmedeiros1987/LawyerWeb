import crypto from "node:crypto";
import { decryptSecret } from "@/lib/crypto";

type TelegramConnection={secretEnc:string|null;webhookSecretEnc:string|null};

function token(connection:TelegramConnection){
  if(!connection.secretEnc)throw new Error("Telegram bot token ausente.");
  return decryptSecret(connection.secretEnc);
}

async function callTelegram(botToken:string,method:string,payload:Record<string,unknown>={}){
  const response=await fetch(`https://api.telegram.org/bot${botToken}/${method}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),
    signal:AbortSignal.timeout(20_000),cache:"no-store",
  });
  const data=await response.json().catch(()=>null) as any;
  if(!response.ok||!data?.ok)throw new Error(data?.description??`Telegram ${method} falhou.`);
  return data.result;
}

export async function inspectTelegramBot(botToken:string){
  const bot=await callTelegram(botToken,"getMe");
  if(!bot?.id||!bot?.username)throw new Error("Token Telegram válido, mas o bot não possui username.");
  return {id:String(bot.id),username:String(bot.username),name:String(bot.first_name??bot.username)};
}

export function newTelegramWebhookSecret(){
  return crypto.randomBytes(24).toString("base64url");
}

export function newTelegramPairingCode(){
  return crypto.randomBytes(12).toString("base64url");
}

export async function registerTelegramWebhook(args:{botToken:string;webhookUrl:string;secret:string}){
  return callTelegram(args.botToken,"setWebhook",{
    url:args.webhookUrl,secret_token:args.secret,allowed_updates:["message"],drop_pending_updates:false,
  });
}

export async function removeTelegramWebhook(connection:TelegramConnection){
  return callTelegram(token(connection),"deleteWebhook",{drop_pending_updates:false});
}

export async function sendTelegramMessage(connection:TelegramConnection,chatId:string,text:string){
  const parts:string[]=[];
  let remaining=text.trim();
  while(remaining.length>3900){parts.push(remaining.slice(0,3900));remaining=remaining.slice(3900);}
  if(remaining)parts.push(remaining);
  for(const part of parts){
    await callTelegram(token(connection),"sendMessage",{chat_id:chatId,text:part,disable_web_page_preview:true});
  }
}

export function telegramWebhookSecret(connection:TelegramConnection){
  if(!connection.webhookSecretEnc)throw new Error("Telegram webhook secret ausente.");
  return decryptSecret(connection.webhookSecretEnc);
}
