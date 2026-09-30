import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input=z.object({
  workspaceId:z.string().optional(),
  matterId:z.string().optional(),
  clientId:z.string().optional(),
  templateId:z.string().optional(),
  letterheadId:z.string().optional(),
  name:z.string().trim().min(2).max(280),
  kind:z.enum(["CONTRACT","OPINION","POWER_OF_ATTORNEY","CERTIFICATE","CORPORATE_ACT","TRADEMARK_PATENT","PETITION","NOTICE","MINUTES","OTHER"]).default("OTHER"),
  status:z.enum(["DRAFT","IN_REVIEW","APPROVED","SIGNING","SIGNED","ARCHIVED"]).default("DRAFT"),
});

async function validateRefs(workspaceId:string,userId:string,parsed:z.infer<typeof input>) {
  if(parsed.matterId&&!(await canAccessMatter(userId,workspaceId,parsed.matterId,P.MATTERS_VIEW))) throw new Error("Processo/assunto inválido ou sem acesso.");
  if(parsed.clientId&&!await prisma.client.findFirst({where:{id:parsed.clientId,workspaceId}})) throw new Error("Cliente inválido.");
  if(parsed.templateId&&!await prisma.documentTemplate.findFirst({where:{id:parsed.templateId,workspaceId}})) throw new Error("Modelo inválido.");
  if(parsed.letterheadId&&!await prisma.letterhead.findFirst({where:{id:parsed.letterheadId,workspaceId}})) throw new Error("Papel timbrado inválido.");
}

export async function GET(request:NextRequest) {
  const session=await auth(); if(!session?.user?.id) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const member=await requireActiveMembership(session.user.id,request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id,member.workspaceId,P.DOCUMENTS_VIEW);
    const q=request.nextUrl.searchParams.get("q")?.trim();
    const kind=request.nextUrl.searchParams.get("kind")?.trim();
    const visibility={OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]};
    const documents=await prisma.legalDocument.findMany({
      where:{workspaceId:member.workspaceId,AND:[
        visibility,
        ...(kind?[{kind}]:[]),
        ...(q?[{OR:[
          {name:{contains:q,mode:"insensitive" as const}},
          {kind:{contains:q,mode:"insensitive" as const}},
          {client:{name:{contains:q,mode:"insensitive" as const}}},
          {matter:{number:{contains:q,mode:"insensitive" as const}}},
          {matter:{title:{contains:q,mode:"insensitive" as const}}},
        ]}]:[]),
      ]},
      include:{
        client:{select:{id:true,name:true}},
        matter:{select:{id:true,number:true,title:true}},
        template:{select:{id:true,name:true}},
        letterhead:{select:{id:true,name:true}},
        _count:{select:{versions:true,contracts:true}},
      },
      orderBy:{updatedAt:"desc"},take:300,
    });
    return NextResponse.json({workspaceId:member.workspaceId,documents});
  } catch(error) {
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}

export async function POST(request:NextRequest) {
  const session=await auth(); if(!session?.user?.id) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const parsed=input.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.DOCUMENTS_EDIT);
    await validateRefs(member.workspaceId,session.user.id,parsed);
    const document=await prisma.$transaction(async tx=>{
      const created=await tx.legalDocument.create({data:{
        workspaceId:member.workspaceId,
        matterId:parsed.matterId||null,clientId:parsed.clientId||null,
        templateId:parsed.templateId||null,letterheadId:parsed.letterheadId||null,
        name:parsed.name,kind:parsed.kind,status:parsed.status,currentVersion:1,createdByUserId:session.user.id,
      }});
      await tx.activityLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,type:"DOCUMENT_CREATED",
        entityType:"LegalDocument",entityId:created.id,summary:`Documento jurídico criado: ${created.name}`,
        metadata:{kind:created.kind,matterId:created.matterId,clientId:created.clientId,status:created.status}
      }});
      return created;
    });
    return NextResponse.json({document},{status:201});
  } catch(error) {
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}
