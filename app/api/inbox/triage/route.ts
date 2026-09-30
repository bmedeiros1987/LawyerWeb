import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { P, canAccessMatter, requirePermission } from "@/lib/authz/permissions";
import { requireActiveMembership } from "@/lib/workspace/context";

const input=z.object({
  workspaceId:z.string().optional(),
  sourceType:z.enum(["COURT","DEMAND"]),
  sourceId:z.string().min(1),
  action:z.enum(["MARK_READ","CREATE_TASK","CREATE_DEADLINE","DISMISS"]),
  matterId:z.string().nullable().optional(),
  clientId:z.string().nullable().optional(),
  title:z.string().trim().max(300).optional(),
  dueAt:z.iso.datetime({offset:true}).transform(value=>new Date(value)).nullable().optional(),
  assigneeUserId:z.string().nullable().optional(),
});

async function validateMatter(userId:string,workspaceId:string,matterId:string|null|undefined){
  if(!matterId)return;
  if(!(await canAccessMatter(userId,workspaceId,matterId,P.MATTERS_VIEW)))throw new Error("Processo/assunto inválido ou sem acesso.");
}
async function validateAssignee(workspaceId:string,userId:string|null|undefined){
  if(!userId)return;
  const member=await prisma.workspaceMember.findUnique({where:{workspaceId_userId:{workspaceId,userId}}});
  if(!member||member.status!=="ACTIVE")throw new Error("Encarregado inválido.");
}
async function alreadyConverted(tx:Prisma.TransactionClient,workspaceId:string,entityType:string,entityId:string,type:string){
  return Boolean(await tx.activityLog.findFirst({where:{workspaceId,entityType,entityId,type},select:{id:true}}));
}

export async function POST(request:NextRequest){
  const session=await auth();
  if(!session?.user?.id)return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const parsed=input.parse(await request.json());
    const member=await requireActiveMembership(session.user.id,parsed.workspaceId);
    await requirePermission(session.user.id,member.workspaceId,P.MATTERS_VIEW);
    await requirePermission(session.user.id,member.workspaceId,P.INBOX_TRIAGE);

    return await prisma.$transaction(async tx=>{
    // Serialize every action on this source. The duplicate check and writes share the lock.
    if(parsed.sourceType==="COURT") await tx.$queryRaw`SELECT id FROM "CourtCommunication" WHERE id=${parsed.sourceId} AND "workspaceId"=${member.workspaceId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "IntakeDemand" WHERE id=${parsed.sourceId} AND "workspaceId"=${member.workspaceId} FOR UPDATE`;
    const entityType=parsed.sourceType==="COURT"?"CourtCommunication":"IntakeDemand";
    const source=parsed.sourceType==="COURT"
      ? await tx.courtCommunication.findFirst({where:{id:parsed.sourceId,workspaceId:member.workspaceId}})
      : await tx.intakeDemand.findFirst({where:{id:parsed.sourceId,workspaceId:member.workspaceId}});
    if(!source)return NextResponse.json({error:"Entrada não encontrada."},{status:404});

    const existingMatterId=source.matterId;
    await validateMatter(session.user.id,member.workspaceId,existingMatterId);
    if(existingMatterId&&parsed.matterId!==undefined&&parsed.matterId!==existingMatterId) {
      return NextResponse.json({error:"O vínculo de origem não pode ser removido ou trocado na triagem."},{status:409});
    }
    if(["TREATED","CONVERTED","ARCHIVED","DISMISSED"].includes(source.status)) {
      return NextResponse.json({error:"Esta entrada já foi tratada. Atualize a Caixa Jurídica."},{status:409});
    }
    const matterId=parsed.matterId===undefined?existingMatterId:parsed.matterId;
    await validateMatter(session.user.id,member.workspaceId,matterId);

    if(parsed.clientId){
      const client=await prisma.client.findFirst({where:{id:parsed.clientId,workspaceId:member.workspaceId}});
      if(!client)return NextResponse.json({error:"Cliente inválido."},{status:400});
    }

    if(parsed.action==="MARK_READ"){
      await tx.activityLog.create({data:{workspaceId:member.workspaceId,userId:session.user.id,type:"INBOX_READ",entityType,entityId:source.id,summary:"Entrada marcada como lida",metadata:{matterId:matterId??null}}});
      if(parsed.sourceType==="COURT"){
        const updated=await tx.courtCommunication.update({where:{id:source.id},data:{
          status:"READ",readAt:new Date(),readByUserId:session.user.id,
          ...(parsed.matterId!==undefined?{matterId:parsed.matterId}:{}),
        }});
        return NextResponse.json({entry:updated});
      }
      const updated=await tx.intakeDemand.update({where:{id:source.id},data:{
        status:"REVIEWING",
        ...(parsed.matterId!==undefined?{matterId:parsed.matterId}:{}),
        ...(parsed.clientId!==undefined?{clientId:parsed.clientId}:{}),
      }});
      return NextResponse.json({entry:updated});
    }

    if(parsed.action==="DISMISS"){
      const result=await (async()=>{
        if(parsed.sourceType==="COURT"){
          await tx.courtCommunication.update({where:{id:source.id},data:{status:"ARCHIVED",requiresAction:false,treatedAt:new Date(),treatedByUserId:session.user.id}});
        }else{
          await tx.intakeDemand.update({where:{id:source.id},data:{status:"DISMISSED",requiresAction:false}});
        }
        await tx.activityLog.create({data:{
          workspaceId:member.workspaceId,userId:session.user.id,type:"INBOX_DISMISSED",
          entityType,entityId:source.id,summary:`Entrada descartada: ${source.title??"sem título"}`,
          metadata:{sourceType:parsed.sourceType}
        }});
        return {ok:true};
      })();
      return NextResponse.json(result);
    }

    if(parsed.action==="CREATE_TASK"){
      await requirePermission(session.user.id,member.workspaceId,P.TASKS_EDIT);
      await validateAssignee(member.workspaceId,parsed.assigneeUserId);
      const assignee=parsed.assigneeUserId||session.user.id;
      await requirePermission(assignee,member.workspaceId,P.TASKS_VIEW);
      await validateMatter(assignee,member.workspaceId,matterId);
      if(await alreadyConverted(tx,member.workspaceId,entityType,source.id,"INBOX_TASK_CREATED")){
        return NextResponse.json({error:"Esta entrada já gerou uma tarefa."},{status:409});
      }
      const suggestedDue=parsed.dueAt!==undefined?parsed.dueAt:(parsed.sourceType==="DEMAND"?(source as {dueCandidate?:Date|null}).dueCandidate??null:null);
      const bodyPreview=parsed.sourceType==="COURT"?(source as {body?:string|null}).body:(source as {bodyPreview?:string|null}).bodyPreview;
      const task=await (async()=>{
        const created=await tx.legalTask.create({data:{
          workspaceId:member.workspaceId,matterId:matterId??null,
          title:parsed.title||source.title||"Demanda recebida",
          description:[
            `Origem: ${parsed.sourceType==="COURT"?(source as {source:string}).source:"Caixa Jurídica"}`,
            bodyPreview?.slice(0,8000)??null,
          ].filter(Boolean).join("\n\n"),
          priority:source.requiresAction?"HIGH":"NORMAL",
          requesterUserId:session.user.id,assigneeUserId:parsed.assigneeUserId||session.user.id,
          dueAt:suggestedDue,private:false,
        }});
        if(parsed.sourceType==="COURT")await tx.courtCommunication.update({where:{id:source.id},data:{status:"TREATED",requiresAction:false,treatedAt:new Date(),treatedByUserId:session.user.id,matterId:matterId??null}});
        else await tx.intakeDemand.update({where:{id:source.id},data:{status:"CONVERTED",requiresAction:false,matterId:matterId??null,...(parsed.clientId!==undefined?{clientId:parsed.clientId}: {})}});
        await tx.activityLog.create({data:{
          workspaceId:member.workspaceId,userId:session.user.id,type:"INBOX_TASK_CREATED",
          entityType,entityId:source.id,summary:`Tarefa criada a partir da Caixa Jurídica: ${created.title}`,
          metadata:{taskId:created.id,matterId:created.matterId,dueAt:created.dueAt}
        }});
        return created;
      })();
      return NextResponse.json({task},{status:201});
    }

    await requirePermission(session.user.id,member.workspaceId,P.DEADLINES_CREATE);
    if(await alreadyConverted(tx,member.workspaceId,entityType,source.id,"INBOX_DEADLINE_CREATED")){
      return NextResponse.json({error:"Esta entrada já gerou um prazo candidato."},{status:409});
    }
    const suggestedDue=parsed.dueAt!==undefined?parsed.dueAt:(parsed.sourceType==="DEMAND"?(source as {dueCandidate?:Date|null}).dueCandidate??null:null);
    const deadline=await (async()=>{
      const created=await tx.deadline.create({data:{
        workspaceId:member.workspaceId,matterId:matterId??null,
        communicationId:parsed.sourceType==="COURT"?source.id:null,
        title:parsed.title||("Prazo — "+(source.title??"comunicação recebida")),
        description:parsed.sourceType==="COURT"?(source as {body?:string|null}).body?.slice(0,12000)??null:(source as {bodyPreview?:string|null}).bodyPreview?.slice(0,12000)??null,
        status:"CANDIDATE",risk:"ATTENTION",
        source:parsed.sourceType==="COURT"?(source as {source:string}).source:(source as {source:string}).source,
        sourceReference:parsed.sourceType==="COURT"?((source as {externalId?:string|null}).externalId??source.id):source.id,
        legalStartAt:null,
        computationTrace:{sourceType:parsed.sourceType,sourceId:source.id,receivedAt:source.receivedAt.toISOString(),evidence:parsed.sourceType==="DEMAND"?(source as {evidence?:Prisma.InputJsonValue}).evidence??null:{officialUrl:(source as {officialUrl?:string|null}).officialUrl??null,contentHash:(source as {contentHash?:string|null}).contentHash??null,publishedAt:(source as {publishedAt?:Date|null}).publishedAt?.toISOString()??null}},
        dueAt:suggestedDue,
        ruleSummary:suggestedDue?"Data sugerida pela origem/triagem; ainda não confirmada como prazo legal.":"Prazo candidato criado a partir da Caixa Jurídica; cálculo legal pendente de revisão humana.",
      }});
      if(parsed.sourceType==="COURT")await tx.courtCommunication.update({where:{id:source.id},data:{status:"TREATED",requiresAction:false,treatedAt:new Date(),treatedByUserId:session.user.id,matterId:matterId??null}});
      else await tx.intakeDemand.update({where:{id:source.id},data:{status:"CONVERTED",requiresAction:false,matterId:matterId??null,...(parsed.clientId!==undefined?{clientId:parsed.clientId}: {})}});
      await tx.activityLog.create({data:{
        workspaceId:member.workspaceId,userId:session.user.id,type:"INBOX_DEADLINE_CREATED",
        entityType,entityId:source.id,summary:`Prazo candidato criado a partir da Caixa Jurídica: ${created.title}`,
        metadata:{deadlineId:created.id,matterId:created.matterId,suggestedDue:created.dueAt}
      }});
      return created;
    })();
    return NextResponse.json({deadline},{status:201});
    },{timeout:15000});
  }catch(error){
    const status=(error as Error&{status?:number}).status??400;
    return NextResponse.json({error:error instanceof Error?error.message:"Invalid request"},{status});
  }
}
