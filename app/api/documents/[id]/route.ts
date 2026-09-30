import { contractScope, documentScope } from "@/lib/authz/visibility";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, memberWithPermission, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const patchInput=z.object({
  workspaceId:z.string().optional(),
  name:z.string().trim().min(2).max(280).optional(),
  kind:z.enum(["CONTRACT","OPINION","POWER_OF_ATTORNEY","CERTIFICATE","CORPORATE_ACT","TRADEMARK_PATENT","PETITION","NOTICE","MINUTES","OTHER"]).optional(),
  status:z.enum(["DRAFT","IN_REVIEW","APPROVED","SIGNING","SIGNED","ARCHIVED"]).optional(),
  clientId:z.string().nullable().optional(),
  matterId:z.string().nullable().optional(),
  templateId:z.string().nullable().optional(),
  letterheadId:z.string().nullable().optional(),
});

async function accessible(id:string,workspaceId:string,userId:string){
  const viewer=await memberWithPermission(userId,workspaceId,P.DOCUMENTS_VIEW);
  if(!viewer)return null;
  const document=await prisma.legalDocument.findFirst({where:{id,AND:[documentScope(viewer)]}});
  if(!document)return null;
  if(document.matterId&&!(await canAccessMatter(userId,workspaceId,document.matterId,P.MATTERS_VIEW)))return null;
  return document;
}

export async function GET(_request:NextRequest,context:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const member=await requireActiveMembership(session.user.id);
    await requirePermission(session.user.id,member.workspaceId,P.DOCUMENTS_VIEW);
    const {id}=await context.params;
    if(!await accessible(id,member.workspaceId,session.user.id))return NextResponse.json({error:"Not found"},{status:404});
    const document=await prisma.legalDocument.findUnique({
      where:{id},
      include:{
        client:true,matter:true,template:true,letterhead:true,
        versions:{orderBy:{version:"desc"},include:{signatureEnvelopes:{orderBy:{requestedAt:"desc"}}}},
        contracts:{where:contractScope(member),orderBy:{updatedAt:"desc"}},
      },
    });
    return NextResponse.json({document});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}

export async function PATCH(request:NextRequest,context:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const parsed=patchInput.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.DOCUMENTS_EDIT);
    const {id}=await context.params;
    const existing=await accessible(id,member.workspaceId,session.user.id);
    if(!existing)return NextResponse.json({error:"Not found"},{status:404});
    if(existing.matterId&&parsed.matterId!==undefined&&parsed.matterId!==existing.matterId)return NextResponse.json({error:"O vínculo ao processo deve ser preservado."},{status:409});
    if(parsed.status==="SIGNING"||parsed.status==="SIGNED")await requirePermission(session.user.id,member.workspaceId,P.DOCUMENTS_SIGN);
    if(parsed.status==="SIGNED"){
      const signed=await prisma.signatureEnvelope.findFirst({where:{status:"SIGNED",signedAt:{not:null},documentVersion:{documentId:id,version:existing.currentVersion}}});
      if(!signed)return NextResponse.json({error:"A versão atual ainda não possui assinatura concluída."},{status:409});
    }
    if(parsed.matterId&&!(await canAccessMatter(session.user.id,member.workspaceId,parsed.matterId,P.MATTERS_VIEW)))return NextResponse.json({error:"Processo/assunto sem acesso."},{status:400});
    if(parsed.clientId&&!await prisma.client.findFirst({where:{id:parsed.clientId,workspaceId:member.workspaceId}}))return NextResponse.json({error:"Cliente inválido."},{status:400});
    if(parsed.templateId&&!await prisma.documentTemplate.findFirst({where:{id:parsed.templateId,workspaceId:member.workspaceId}}))return NextResponse.json({error:"Modelo inválido."},{status:400});
    if(parsed.letterheadId&&!await prisma.letterhead.findFirst({where:{id:parsed.letterheadId,workspaceId:member.workspaceId}}))return NextResponse.json({error:"Papel timbrado inválido."},{status:400});
    const {workspaceId:_workspaceId,...changes}=parsed;
    const document=await prisma.$transaction(async tx=>{
      const updated=await tx.legalDocument.update({where:{id},data:changes});
      await tx.activityLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,type:"DOCUMENT_UPDATED",
        entityType:"LegalDocument",entityId:id,summary:`Documento atualizado: ${updated.name}`,
        metadata:{kind:updated.kind,status:updated.status,currentVersion:updated.currentVersion}
      }});
      return updated;
    });
    return NextResponse.json({document});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}
