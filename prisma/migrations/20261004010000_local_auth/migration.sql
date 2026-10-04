CREATE TABLE "LocalCredential" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "emailNormalized" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocalCredential_emailNormalized_key" ON "LocalCredential"("emailNormalized");
CREATE TABLE "LocalSession" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LocalSession_userId_idx" ON "LocalSession"("userId");
CREATE INDEX "LocalSession_expiresAt_idx" ON "LocalSession"("expiresAt");
CREATE TABLE "LocalAuthChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "userId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LocalAuthChallenge_tokenHash_key" ON "LocalAuthChallenge"("tokenHash");
CREATE INDEX "LocalAuthChallenge_expiresAt_idx" ON "LocalAuthChallenge"("expiresAt");
CREATE TABLE "LocalAuthRateLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "attempts" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "LocalAuthRateLimit_expiresAt_idx" ON "LocalAuthRateLimit"("expiresAt");
-- Requires a separately reviewed duplicate-email audit before any production migration.
CREATE UNIQUE INDEX "User_email_casefold_key" ON "User" (lower(btrim(email))) WHERE email IS NOT NULL;
CREATE TABLE "LocalAuthMailJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "LocalAuthMailJob_availableAt_expiresAt_idx" ON "LocalAuthMailJob"("availableAt", "expiresAt");
