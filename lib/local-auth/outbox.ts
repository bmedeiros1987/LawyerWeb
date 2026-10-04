import { prisma } from "@/lib/prisma";
import { tokenHash } from "./crypto";
import { beginChallenge, normalizeEmail, rateLimit } from "./service";
import { type AuthMailer, type Purpose } from "./mail";

// Always queue the same command, even for an unknown/ineligible account.
// Account lookup and SMTP happen only after the public response has finished.
export async function queueAuthMail(emailInput: string, purpose: Purpose) {
  const email = normalizeEmail(emailInput);
  await rateLimit("mail-global", "global", 60, 3600);
  await rateLimit("mail-address", email, 3, 900);
  const id = tokenHash(JSON.stringify([purpose, email]));
  await prisma.localAuthMailJob.deleteMany({ where: { id, expiresAt: { lte: new Date() } } });
  await prisma.localAuthMailJob.upsert({ where: { id }, update: {},
    create: { id, email, purpose, expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  return id;
}

export async function deliverAuthJob(id: string, deliver: AuthMailer) {
  const now = new Date(), lease = new Date(Date.now() + 120_000);
  const claimed = await prisma.localAuthMailJob.updateMany({ where: { id, availableAt: { lte: now }, expiresAt: { gt: now } }, data: { availableAt: lease, attempts: { increment: 1 } } });
  if (claimed.count !== 1) return;
  const job = await prisma.localAuthMailJob.findUnique({ where: { id } });
  if (!job || (job.purpose !== "REGISTER" && job.purpose !== "RESET")) return;
  try {
    await beginChallenge(job.email, job.purpose, deliver);
    await prisma.localAuthMailJob.deleteMany({ where: { id, availableAt: lease } });
  } catch {
    // Keep durable work for a bounded retry after the lease. Never log mail/tokens.
  }
}

export async function drainAuthMail(deliver: AuthMailer) {
  const now = new Date();
  await prisma.localAuthMailJob.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.localAuthChallenge.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.localAuthRateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.localSession.deleteMany({ where: { expiresAt: { lte: now } } });
  const jobs = await prisma.localAuthMailJob.findMany({ where: { availableAt: { lte: now }, expiresAt: { gt: now } }, orderBy: { availableAt: "asc" }, take: 5, select: { id: true } });
  for (const job of jobs) await deliverAuthJob(job.id, deliver);
  return jobs.length;
}
