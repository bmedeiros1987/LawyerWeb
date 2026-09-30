import { redirect } from "next/navigation";
import { Bot, ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, memberWithPermission } from "@/lib/authz/permissions";
import { getActiveMembership } from "@/lib/workspace/context";
import { OpenClawAgentSettings } from "@/components/openclaw-agent-settings";
import { TelegramAgentSettings } from "@/components/telegram-agent-settings";

export const dynamic="force-dynamic";

export default async function OpenClawPage(){
  const session=await auth();
  if(!session?.user?.id) redirect("/login");
  const member=await getActiveMembership(session.user.id);
  if(!member) redirect("/app/setup");
  const canUse=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.AGENT_USE));
  if(!canUse) redirect("/app/integrations");
  const canManage=Boolean(await memberWithPermission(session.user.id,member.workspaceId,P.AGENT_MANAGE));

  const [connection,preferences,gmail,telegram]=await Promise.all([
    prisma.openClawConnection.findUnique({where:{workspaceId:member.workspaceId}}),
    prisma.agentChannelPreference.findMany({where:{workspaceId:member.workspaceId,userId:session.user.id}}),
    prisma.googleGmailConnection.findUnique({where:{workspaceId_userId:{workspaceId:member.workspaceId,userId:session.user.id}}}),
    prisma.agentChannelConnection.findUnique({
      where:{workspaceId_channel_accountKey:{workspaceId:member.workspaceId,channel:"TELEGRAM",accountKey:"workspace-bot"}},
      select:{id:true,displayName:true,status:true,externalIdentity:true,connectedAt:true},
    }),
  ]);
  const telegramIdentity=telegram?await prisma.agentExternalIdentity.findUnique({
    where:{channelConnectionId_userId:{channelConnectionId:telegram.id,userId:session.user.id}},
    select:{status:true,displayName:true,verifiedAt:true},
  }):null;
  const telegramPreference=preferences.find(p=>p.channel==="TELEGRAM");

  return <div className="page-stack">
    <section className="page-header">
      <div><span className="eyebrow">MBLZ Agent Hub</span><h1>Agente próprio do escritório</h1><p>OpenClaw como runtime do agente; MBLZ continua controlando identidade, sigilo, contexto e auditoria.</p></div>
      <span className="status-pill success"><ShieldCheck size={11}/>Isolado por workspace</span>
    </section>

    <section className="panel agent-architecture-strip">
      <Bot size={20}/>
      <div><strong>Uma conversa, vários canais.</strong><span>E-mail, Telegram, WhatsApp e Web convergem para o mesmo agente, sempre associados ao usuário e ao workspace corretos.</span></div>
    </section>

    <OpenClawAgentSettings
      workspaceId={member.workspaceId}
      canManage={canManage}
      gmailConnected={Boolean(gmail)}
      connection={connection?{
        gatewayUrl:connection.gatewayUrl,
        agentId:connection.agentId,
        status:connection.status,
        lastHealthAt:connection.lastHealthAt?.toISOString()??null,
      }:null}
      preferences={preferences.map(p=>({channel:p.channel,enabled:p.enabled,mode:p.mode}))}
    />

    <TelegramAgentSettings
      workspaceId={member.workspaceId}
      canManage={canManage}
      connection={telegram?{
        id:telegram.id,displayName:telegram.displayName,status:telegram.status,
        externalIdentity:telegram.externalIdentity,connectedAt:telegram.connectedAt?.toISOString()??null,
      }:null}
      identity={telegramIdentity?{
        status:telegramIdentity.status,displayName:telegramIdentity.displayName,
        verifiedAt:telegramIdentity.verifiedAt?.toISOString()??null,
      }:null}
      enabled={Boolean(telegramPreference?.enabled)}
    />
  </div>;
}
