import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input = z.object({
  workspaceId: z.string().optional(),
  clientId: z.string().optional(),
  matterId: z.string().optional(),
  documentId: z.string().optional(),
  title: z.string().trim().min(2).max(260),
  contractType: z.string().trim().min(2).max(120),
  status: z.enum(["DRAFT","NEGOTIATION","REVIEW","SIGNING","ACTIVE","EXPIRING","EXPIRED","TERMINATED","ARCHIVED"]).default("DRAFT"),
  counterparty: z.string().trim().max(220).optional(),
  effectiveAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  noticeDays: z.number().int().min(0).max(3650).optional(),
  autoRenew: z.boolean().default(false),
  amount: z.number().nonnegative().max(1e15).optional(),
  currency: z.string().trim().min(3).max(3).default("BRL"),
  responsibleUserId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

async function validateReferences(workspaceId:string, userId:string, parsed:z.infer<typeof input>) {
  if (parsed.clientId) {
    const client=await prisma.client.findFirst({where:{id:parsed.clientId,workspaceId}});
    if(!client) throw new Error("Cliente inválido para este workspace.");
  }
  if (parsed.matterId) {
    const allowed=await canAccessMatter(userId,workspaceId,parsed.matterId,P.MATTERS_VIEW);
    if(!allowed) throw new Error("Processo/assunto inválido ou sem acesso.");
  }
  if (parsed.documentId) {
    const document=await prisma.legalDocument.findFirst({where:{id:parsed.documentId,workspaceId}});
    if(!document) throw new Error("Documento inválido para este workspace.");
  }
  if (parsed.responsibleUserId) {
    const responsible=await prisma.workspaceMember.findUnique({where:{workspaceId_userId:{workspaceId,userId:parsed.responsibleUserId}}});
    if(!responsible||responsible.status!=="ACTIVE") throw new Error("Responsável inválido.");
  }
  if(parsed.effectiveAt&&parsed.expiresAt&&parsed.expiresAt<parsed.effectiveAt) throw new Error("A vigência final deve ser posterior ao início.");
}

export async function GET(request:NextRequest) {
  const session=await auth();
  if(!session?.user?.id) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const member=await requireActiveMembership(session.user.id,request.nextUrl.searchParams.get("workspaceId"));
    await requirePermission(session.user.id,member.workspaceId,P.CONTRACTS_VIEW);
    const q=request.nextUrl.searchParams.get("q")?.trim();
    const status=request.nextUrl.searchParams.get("status")?.trim();
    const visibility={OR:[{matterId:null},{matter:{secrecy:false}},{matter:{access:{some:{memberId:member.id}}}}]};
    const contracts=await prisma.contract.findMany({
      where:{
        workspaceId:member.workspaceId,
        AND:[
          visibility,
          ...(status?[{status:status as never}]:[]),
          ...(q?[{OR:[
            {title:{contains:q,mode:"insensitive" as const}},
            {contractType:{contains:q,mode:"insensitive" as const}},
            {counterparty:{contains:q,mode:"insensitive" as const}},
            {client:{name:{contains:q,mode:"insensitive" as const}}},
            {matter:{number:{contains:q,mode:"insensitive" as const}}},
          ]}]:[]),
        ],
      },
      include:{client:{select:{id:true,name:true}},matter:{select:{id:true,number:true,title:true}},document:{select:{id:true,name:true,currentVersion:true}}},
      orderBy:[{expiresAt:"asc"},{updatedAt:"desc"}],
      take:300,
    });
    return NextResponse.json({workspaceId:member.workspaceId,contracts});
  } catch(error) {
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}

export async function POST(request:NextRequest) {
  const session=await auth();
  if(!session?.user?.id) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const parsed=input.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.CONTRACTS_EDIT);
    await validateReferences(member.workspaceId,session.user.id,parsed);
    const contract=await prisma.$transaction(async tx=>{
      const created=await tx.contract.create({data:{
        workspaceId:member.workspaceId,
        clientId:parsed.clientId||null,
        matterId:parsed.matterId||null,
        documentId:parsed.documentId||null,
        title:parsed.title,
        contractType:parsed.contractType,
        status:parsed.status,
        counterparty:parsed.counterparty||null,
        effectiveAt:parsed.effectiveAt||null,
        expiresAt:parsed.expiresAt||null,
        noticeDays:parsed.noticeDays??null,
        autoRenew:parsed.autoRenew,
        amount:parsed.amount,
        currency:parsed.currency.toUpperCase(),
        responsibleUserId:parsed.responsibleUserId||session.user.id,
        metadata:parsed.metadata,
      }});
      await tx.activityLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,type:"CONTRACT_CREATED",
        entityType:"Contract",entityId:created.id,summary:`Contrato cadastrado: ${created.title}`,
        metadata:{clientId:created.clientId,matterId:created.matterId,status:created.status,expiresAt:created.expiresAt}
      }});
      return created;
    });
    return NextResponse.json({contract},{status:201});
  } catch(error) {
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}
