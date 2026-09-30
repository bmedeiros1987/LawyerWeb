import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { P, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";
import { probeOpenClaw } from "@/lib/agent/openclaw";

const input=z.object({
  workspaceId:z.string().optional(),
  gatewayUrl:z.string().url(),
  gatewayToken:z.string().min(24).max(4096),
  agentId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).default("default"),
});

export async function GET(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const member=await requireActiveMembership(session.user.id,request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_USE);
    const connection=await prisma.openClawConnection.findUnique({where:{workspaceId:member.workspaceId}});
    return NextResponse.json({connection:connection?{
      id:connection.id,gatewayUrl:connection.gatewayUrl,agentId:connection.agentId,status:connection.status,
      version:connection.version,lastHealthAt:connection.lastHealthAt,lastError:connection.lastError,
    }:null});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Solicitação inválida"},{status});
  }
}

export async function POST(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const parsed=input.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.AGENT_MANAGE);

    const probe=await probeOpenClaw(parsed.gatewayUrl,parsed.gatewayToken,parsed.agentId);
    if(!probe.agentAvailable) return NextResponse.json({error:"O Gateway respondeu, mas o agente informado não está disponível."},{status:400});

    const now=new Date();
    const connection=await prisma.$transaction(async tx=>{
      const saved=await tx.openClawConnection.upsert({
        where:{workspaceId:member.workspaceId},
        create:{
          workspaceId:member.workspaceId,gatewayUrl:probe.baseUrl,gatewayTokenEnc:encryptSecret(parsed.gatewayToken),
          agentId:parsed.agentId,status:"CONNECTED",lastHealthAt:now,lastError:null,createdByUserId:session.user.id,
        },
        update:{
          gatewayUrl:probe.baseUrl,gatewayTokenEnc:encryptSecret(parsed.gatewayToken),agentId:parsed.agentId,
          status:"CONNECTED",lastHealthAt:now,lastError:null,
        },
      });
      await tx.auditLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,action:"OPENCLAW_CONNECTED",
        entityType:"OpenClawConnection",entityId:saved.id,metadata:{gatewayUrl:probe.baseUrl,agentId:parsed.agentId}
      }});
      return saved;
    });
    return NextResponse.json({connection:{id:connection.id,gatewayUrl:connection.gatewayUrl,agentId:connection.agentId,status:connection.status,lastHealthAt:connection.lastHealthAt}});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível conectar o OpenClaw."},{status});
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
    const existing=await prisma.openClawConnection.findUnique({where:{workspaceId:member.workspaceId}});
    if(existing){
      await prisma.$transaction(async tx=>{
        await tx.openClawConnection.delete({where:{id:existing.id}});
        await tx.auditLog.create({data:{
          workspaceId:member.workspaceId,userId:session.user.id,action:"OPENCLAW_DISCONNECTED",
          entityType:"OpenClawConnection",entityId:existing.id,metadata:{gatewayUrl:existing.gatewayUrl,agentId:existing.agentId}
        }});
      });
    }
    return NextResponse.json({ok:true});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível desconectar."},{status});
  }
}
