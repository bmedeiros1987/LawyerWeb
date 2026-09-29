import { google, gmail_v1 } from "googleapis";
import type { Credentials } from "google-auth-library";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createGoogleOAuthClient, gmailRedirectUri } from "@/lib/google/oauth";

async function persistTokens(id: string, credentials: Credentials) {
  const data: { accessTokenEnc?: string; refreshTokenEnc?: string; expiresAt?: Date; scope?: string } = {};
  if (credentials.access_token) data.accessTokenEnc = encryptSecret(credentials.access_token);
  if (credentials.refresh_token) data.refreshTokenEnc = encryptSecret(credentials.refresh_token);
  if (credentials.expiry_date) data.expiresAt = new Date(credentials.expiry_date);
  if (credentials.scope) data.scope = credentials.scope;
  if (Object.keys(data).length) await prisma.googleGmailConnection.update({ where: { id }, data });
}

export async function authorizedGmail(id: string) {
  const connection = await prisma.googleGmailConnection.findUniqueOrThrow({ where: { id } });
  const oauth = createGoogleOAuthClient(gmailRedirectUri());
  oauth.setCredentials({
    access_token: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
    refresh_token: connection.refreshTokenEnc ? decryptSecret(connection.refreshTokenEnc) : undefined,
    expiry_date: connection.expiresAt?.getTime(),
  });
  await oauth.getAccessToken();
  await persistTokens(connection.id, oauth.credentials);
  return { connection, gmail: google.gmail({ version: "v1", auth: oauth }) };
}

function header(message: gmail_v1.Schema$Message, name: string) {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodePart(data?: string | null) {
  if (!data) return "";
  try { return Buffer.from(data, "base64url").toString("utf8"); } catch { return ""; }
}

function plainText(part?: gmail_v1.Schema$MessagePart | null): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodePart(part.body.data);
  for (const child of part.parts ?? []) {
    const found = plainText(child);
    if (found.trim()) return found;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodePart(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function likelyRequiresAction(subject: string, body: string) {
  const text = `${subject} ${body}`.toLowerCase();
  return /(prazo|urgente|até\s|aud[ií]encia|intima|revis|contrato|aditivo|parecer|notifica|provid[eê]ncia|responder|retorno)/i.test(text);
}

export async function ingestGmailMessage(connectionId: string, messageId: string) {
  const { connection, gmail } = await authorizedGmail(connectionId);
  const response = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const message = response.data;
  const subject = header(message, "Subject") ?? "(sem assunto)";
  const sender = header(message, "From");
  const to = header(message, "To");
  const cc = header(message, "Cc");
  const body = plainText(message.payload).slice(0, 12000);
  const receivedAt = message.internalDate ? new Date(Number(message.internalDate)) : new Date();
  const recipients = [to, cc].filter((v): v is string => Boolean(v));
  const requiresAction = likelyRequiresAction(subject, body);

  return prisma.intakeDemand.upsert({
    where: {
      workspaceId_source_externalId: {
        workspaceId: connection.workspaceId,
        source: "GMAIL",
        externalId: messageId,
      },
    },
    create: {
      workspaceId: connection.workspaceId,
      source: "GMAIL",
      externalId: messageId,
      threadId: message.threadId ?? null,
      title: subject,
      bodyPreview: body || message.snippet || null,
      sender,
      recipients,
      receivedAt,
      status: "NEW",
      requiresAction,
      evidence: {
        gmailMessageId: messageId,
        gmailThreadId: message.threadId ?? null,
        labels: message.labelIds ?? [],
        snippet: message.snippet ?? null,
      },
    },
    update: {
      threadId: message.threadId ?? null,
      title: subject,
      bodyPreview: body || message.snippet || null,
      sender,
      recipients,
      receivedAt,
      requiresAction,
      evidence: {
        gmailMessageId: messageId,
        gmailThreadId: message.threadId ?? null,
        labels: message.labelIds ?? [],
        snippet: message.snippet ?? null,
      },
    },
  });
}

export async function initialGmailSync(connectionId: string, limit = 100) {
  const { connection, gmail } = await authorizedGmail(connectionId);
  let pageToken: string | undefined;
  let count = 0;
  do {
    const r = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:30d",
      maxResults: 100,
      pageToken,
      ...(connection.labelIds.length ? { labelIds: connection.labelIds } : {}),
    });
    for (const m of r.data.messages ?? []) {
      if (!m.id) continue;
      await ingestGmailMessage(connectionId, m.id);
      count += 1;
      if (count >= limit) break;
    }
    if (count >= limit) break;
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken);

  const profile = await gmail.users.getProfile({ userId: "me" });
  if (profile.data.historyId) {
    await prisma.googleGmailConnection.update({ where: { id: connectionId }, data: { historyId: profile.data.historyId } });
  }
  return { count, historyId: profile.data.historyId ?? null };
}

export async function syncGmailHistory(connectionId: string, hintedHistoryId?: string) {
  const { connection, gmail } = await authorizedGmail(connectionId);
  if (!connection.historyId) return initialGmailSync(connectionId);

  let pageToken: string | undefined;
  let latestHistoryId = hintedHistoryId ?? connection.historyId;
  const messageIds = new Set<string>();

  try {
    do {
      const r = await gmail.users.history.list({
        userId: "me",
        startHistoryId: connection.historyId,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });
      for (const h of r.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) if (added.message?.id) messageIds.add(added.message.id);
      }
      latestHistoryId = r.data.historyId ?? latestHistoryId;
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) return initialGmailSync(connectionId);
    throw error;
  }

  for (const id of messageIds) await ingestGmailMessage(connectionId, id);
  await prisma.googleGmailConnection.update({ where: { id: connectionId }, data: { historyId: latestHistoryId } });
  return { count: messageIds.size, historyId: latestHistoryId };
}

export async function startGmailWatch(connectionId: string) {
  const topicName = process.env.GOOGLE_GMAIL_PUBSUB_TOPIC;
  if (!topicName) return { skipped: true as const, reason: "GOOGLE_GMAIL_PUBSUB_TOPIC is not configured" };
  const { connection, gmail } = await authorizedGmail(connectionId);
  const r = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      ...(connection.labelIds.length ? { labelIds: connection.labelIds, labelFilterBehavior: "include" } : {}),
    },
  });
  await prisma.googleGmailConnection.update({
    where: { id: connectionId },
    data: {
      historyId: r.data.historyId ?? connection.historyId,
      watchExpiresAt: r.data.expiration ? new Date(Number(r.data.expiration)) : null,
    },
  });
  return { skipped: false as const, historyId: r.data.historyId ?? null, expiration: r.data.expiration ?? null };
}
