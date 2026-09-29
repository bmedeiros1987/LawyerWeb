import crypto from "node:crypto";
import { calendar_v3, google } from "googleapis";
import type { Credentials } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, sha256 } from "@/lib/crypto";
import { appUrl, createGoogleOAuthClient } from "@/lib/google/oauth";
const TZ="America/Sao_Paulo";

async function persist(id:string,c:Credentials){
  const data:{accessTokenEnc?:string;refreshTokenEnc?:string;expiresAt?:Date;scope?:string}={};
  if(c.access_token)data.accessTokenEnc=encryptSecret(c.access_token);
  if(c.refresh_token)data.refreshTokenEnc=encryptSecret(c.refresh_token);
  if(c.expiry_date)data.expiresAt=new Date(c.expiry_date);
  if(c.scope)data.scope=c.scope;
  if(Object.keys(data).length)await prisma.googleCalendarConnection.update({where:{id},data});
}
export async function authorizedCalendar(id:string){
  const connection=await prisma.googleCalendarConnection.findUniqueOrThrow({where:{id}});
  const oauth=createGoogleOAuthClient();
  oauth.setCredentials({access_token:connection.accessTokenEnc?decryptSecret(connection.accessTokenEnc):undefined,refresh_token:connection.refreshTokenEnc?decryptSecret(connection.refreshTokenEnc):undefined,expiry_date:connection.expiresAt?.getTime()});
  await oauth.getAccessToken(); await persist(connection.id,oauth.credentials);
  return {connection,calendar:google.calendar({version:"v3",auth:oauth})};
}
export async function ensureArcoraCalendar(id:string){
  const {connection,calendar}=await authorizedCalendar(id);
  if(connection.calendarId){try{await calendar.calendars.get({calendarId:connection.calendarId});return connection.calendarId}catch(e:unknown){const s=(e as {response?:{status?:number}})?.response?.status;if(s!==404&&s!==410)throw e}}
  const created=await calendar.calendars.insert({requestBody:{summary:"Arcora",description:"Agenda jurídica sincronizada pelo Arcora.",timeZone:TZ}});
  if(!created.data.id)throw new Error("Google did not return a calendar ID");
  await prisma.googleCalendarConnection.update({where:{id},data:{calendarId:created.data.id,calendarName:created.data.summary??"Arcora",syncToken:null}});
  return created.data.id;
}
export async function registerCalendarWatch(id:string){
  const base=appUrl(); if(!base.startsWith("https://")||base.includes("localhost"))return {skipped:true as const,reason:"Webhook requires public HTTPS"};
  const {connection,calendar}=await authorizedCalendar(id); const calendarId=connection.calendarId??await ensureArcoraCalendar(id);
  const channelId=crypto.randomUUID(), token=crypto.randomBytes(32).toString("base64url");
  const r=await calendar.events.watch({calendarId,requestBody:{id:channelId,type:"web_hook",address:`${base}/api/webhooks/google-calendar`,token,expiration:String(Date.now()+6*24*60*60*1000)}});
  await prisma.googleCalendarConnection.update({where:{id},data:{watchChannelId:channelId,watchResourceId:r.data.resourceId??null,watchTokenHash:sha256(token),watchExpiresAt:r.data.expiration?new Date(Number(r.data.expiration)):null}});
  await syncCalendar(id); return {skipped:false as const,channelId};
}
function dates(e:calendar_v3.Schema$Event){return {allDay:Boolean(e.start?.date),startAt:e.start?.dateTime?new Date(e.start.dateTime):null,endAt:e.end?.dateTime?new Date(e.end.dateTime):null,startDate:e.start?.date??null,endDate:e.end?.date??null,timeZone:e.start?.timeZone??e.end?.timeZone??TZ}}
async function apply(userId:string,calendarId:string,item:calendar_v3.Schema$Event){
  if(!item.id)return;
  if(item.status==="cancelled"){await prisma.legalCalendarEvent.updateMany({where:{userId,googleEventId:item.id},data:{status:"CANCELLED",googleUpdatedAt:item.updated?new Date(item.updated):new Date()}});return}
  const arcoraEventId=item.extendedProperties?.private?.arcoraEventId;
  const data={title:item.summary||"Evento sem título",description:item.description??null,location:item.location??null,status:"CONFIRMED",source:arcoraEventId?"ARCORA":"GOOGLE",googleEventId:item.id,googleCalendarId:calendarId,googleUpdatedAt:item.updated?new Date(item.updated):new Date(),...dates(item)};
  if(arcoraEventId){const owned=await prisma.legalCalendarEvent.findFirst({where:{id:arcoraEventId,userId}});if(owned){await prisma.legalCalendarEvent.update({where:{id:owned.id},data});return}}
  const existing=await prisma.legalCalendarEvent.findFirst({where:{userId,googleEventId:item.id}});
  if(existing)await prisma.legalCalendarEvent.update({where:{id:existing.id},data});else await prisma.legalCalendarEvent.create({data:{userId,...data}});
}
export async function syncCalendar(id:string,forceFull=false):Promise<void>{
  const {connection,calendar}=await authorizedCalendar(id); const calendarId=connection.calendarId??await ensureArcoraCalendar(id);let pageToken:string|undefined,nextSyncToken:string|undefined;
  try{do{const r=await calendar.events.list({calendarId,showDeleted:true,singleEvents:true,maxResults:2500,pageToken,...(forceFull||!connection.syncToken?{}:{syncToken:connection.syncToken})});for(const item of r.data.items??[])await apply(connection.userId,calendarId,item);pageToken=r.data.nextPageToken??undefined;if(!pageToken&&r.data.nextSyncToken)nextSyncToken=r.data.nextSyncToken}while(pageToken)}
  catch(e:unknown){const s=(e as {response?:{status?:number}})?.response?.status;if(s===410&&!forceFull){await prisma.googleCalendarConnection.update({where:{id},data:{syncToken:null}});return syncCalendar(id,true)}throw e}
  if(nextSyncToken)await prisma.googleCalendarConnection.update({where:{id},data:{syncToken:nextSyncToken}});
}
function body(e:{id:string;title:string;description:string|null;location:string|null;allDay:boolean;startAt:Date|null;endAt:Date|null;startDate:string|null;endDate:string|null;timeZone:string}){
  if(e.allDay&&(!e.startDate||!e.endDate))throw new Error("All-day event is missing dates");if(!e.allDay&&(!e.startAt||!e.endAt))throw new Error("Timed event is missing date-times");
  return {summary:e.title,description:e.description??undefined,location:e.location??undefined,visibility:"private",start:e.allDay?{date:e.startDate!}:{dateTime:e.startAt!.toISOString(),timeZone:e.timeZone},end:e.allDay?{date:e.endDate!}:{dateTime:e.endAt!.toISOString(),timeZone:e.timeZone},extendedProperties:{private:{arcoraEventId:e.id}}} satisfies calendar_v3.Schema$Event;
}
export async function pushArcoraEventToGoogle(eventId:string){
  const e=await prisma.legalCalendarEvent.findUniqueOrThrow({where:{id:eventId}});const c=await prisma.googleCalendarConnection.findUnique({where:{userId:e.userId}});if(!c)return null;
  const {calendar}=await authorizedCalendar(c.id);const calendarId=c.calendarId??await ensureArcoraCalendar(c.id);const requestBody=body(e);
  const r=e.googleEventId?await calendar.events.update({calendarId,eventId:e.googleEventId,requestBody}):await calendar.events.insert({calendarId,requestBody});
  if(r.data.id)await prisma.legalCalendarEvent.update({where:{id:e.id},data:{googleEventId:r.data.id,googleCalendarId:calendarId,googleUpdatedAt:r.data.updated?new Date(r.data.updated):new Date()}});
  return r.data;
}
export async function deleteArcoraEventFromGoogle(eventId:string){
  const e=await prisma.legalCalendarEvent.findUniqueOrThrow({where:{id:eventId}});if(!e.googleEventId||!e.googleCalendarId)return;
  const c=await prisma.googleCalendarConnection.findUnique({where:{userId:e.userId}});if(!c)return;const {calendar}=await authorizedCalendar(c.id);await calendar.events.delete({calendarId:e.googleCalendarId,eventId:e.googleEventId});
}
export async function stopWatch(id:string){const {connection,calendar}=await authorizedCalendar(id);if(!connection.watchChannelId||!connection.watchResourceId)return;try{await calendar.channels.stop({requestBody:{id:connection.watchChannelId,resourceId:connection.watchResourceId}})}catch{}}
