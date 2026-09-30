import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const patchInput=z.object({
  workspaceId:z.string().optional(),
  clientId:z.string().nullable().optional(),
  matterId:z.string().nullable().optional(),
  documentId:z.string().nullable().optional(),
  title:z.string().trim().min(2).max(260).optional(),
  contractType:z.string().trim().min(2).max(120).optional(),
  status:z.enum(["DRAFT","NEGOTIATION","REVIEW","SIGNING","ACTIVE","EXPIRING","EXPIRED","TERMINATED","ARCHIVED"]).optional(),
  counterparty:z.string().trim().max(220).nullable().optional(),
  effectiveAt:z.coerce.date().nullable().optional(),
  expiresAt:z.coerce.date().nullable().optional(),
  noticeDays:z.number().int().min(0).max(3650).nullable().optional(),
  autoRenew:z.boolean().optional(),
  amount:z.number().nonnegative().max(1e15).nullable().optional(),
  currency:z.string().trim().min(3).max(3).optional(),
  responsibleUserId:z.string().nullable().optional(),
});

async function findAccessible(id:string,workspaceId:string,userId:string) {
  const contract=await prisma.contract.findFirst({where:{id,workspaceId}});
  if(!contract) return null;
  if(contract.matterId&&!(await canAccessMatter(userId,workspaceId,contract.matterId,P.MATTERS_VIEW))) return null;
  return contract;
}

export async function GET(_request:NextRequest,context:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user?.id) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const member=await requireActiveMembership(session.user.id);
    await requirePermission(session.user.id,member.workspaceId,P.CONTRACTS_VIEW);
    const {id}=await context.params;
    const allowed=await findAccessible(id,member.workspaceId,session.user.id);
    if(!allowed) return NextResponse.json({error:"Not found"},{status:404});
    const contract=await prisma.contract.findUnique({
      where:{id},
      include:{client:true,matter:true,document:{include:{versions:{orderBy:{version:"desc"},take:10}}}},
    });
    return NextResponse.json({contract});
  } catch(error) {
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}

export async function PATCH(request:NextRequest,context:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user?.id) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const parsed=patchInput.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.CONTRACTS_EDIT);
    const {id}=await context.params;
    const existing=await findAccessible(id,member.workspaceId,session.user.id);
    if(!existing) return NextResponse.json({error:"Not found"},{status:404});

    if(parsed.matterId){
      if(!(await canAccessMatter(session.user.id,member.workspaceId,parsed.matterId,P.MATTERS_VIEW))) return NextResponse.json({error:"Processo/assunto sem acesso."},{status:400});
    }
    if(parsed.clientId){
      const client=await prisma.client.findFirst({where:{id:parsed.clientId,workspaceId:member.workspaceId}});
      if(!client) return NextResponse.json({error:"Cliente inválido."},{status:400});
    }
    if(parsed.documentId){
      const document=await prisma.legalDocument.findFirst({where:{id:parsed.documentId,workspaceId:member.workspaceId}});
      if(!document) return NextResponse.json({error:"Documento inválido."},{status:400});
    }
    if(parsed.responsibleUserId){
      const target=await prisma.workspaceMember.findUnique({where:{workspaceId_userId:{workspaceId:member.workspaceId,userId:parsed.responsibleUserId}}});
      if(!target||target.status!=="ACTIVE") return NextResponse.json({error:"Responsável inválido."},{status:400});
    }
    const effective=parsed.effectiveAt===undefined?existing.effectiveAt:parsed.effectiveAt;
    const expires=parsed.expiresAt===undefined?existing.expiresAt:parsed.expiresAt;
    if(effective&&expires&&expires<effective) return NextResponse.json({error:"A vigência final deve ser posterior ao início."},{status:400});

    const {workspaceId:_workspaceId,...changes}=parsed;
    const contract=await prisma.$transaction(async tx=>{
      const updated=await tx.contract.update({where:{id},data:{...changes,currency:changes.currency?.toUpperCase()}});
      await tx.activityLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,type:"CONTRACT_UPDATED",
        entityType:"Contract",entityId:id,summary:`Contrato atualizado: ${updated.title}`,
        metadata:{status:updated.status,expiresAt:updated.expiresAt,responsibleUserId:updated.responsibleUserId}
      }});
      return updated;
    });
    return NextResponse.json({contract});
  } catch(error) {
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}
