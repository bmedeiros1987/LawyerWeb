-- CreateEnum
CREATE TYPE "AgentChannel" AS ENUM ('WEB', 'EMAIL', 'WHATSAPP', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "AgentConnectionStatus" AS ENUM ('DISCONNECTED', 'PENDING', 'CONNECTED', 'ERROR', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'OPENCLAW',
    "agentId" TEXT NOT NULL DEFAULT 'mblz',
    "displayName" TEXT NOT NULL DEFAULT 'MBLZ Agent',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "policy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChannelConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "channel" "AgentChannel" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'OPENCLAW',
    "accountId" TEXT NOT NULL,
    "status" "AgentConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "displayName" TEXT,
    "maskedAddress" TEXT,
    "externalIdentityHash" TEXT,
    "capabilities" JSONB,
    "metadata" JSONB,
    "consentedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastHealthAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "channel" "AgentChannel" NOT NULL DEFAULT 'WEB',
    "requestType" TEXT NOT NULL DEFAULT 'CHAT',
    "status" "AgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "providerRunId" TEXT,
    "sessionKeyHash" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT,
    "outputPreview" TEXT,
    "errorCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentProfile_workspaceId_enabled_idx" ON "AgentProfile"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_workspaceId_userId_key" ON "AgentProfile"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "AgentChannelConnection_agentProfileId_status_idx" ON "AgentChannelConnection"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "AgentChannelConnection_workspaceId_channel_status_idx" ON "AgentChannelConnection"("workspaceId", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentChannelConnection_workspaceId_userId_channel_accountId_key" ON "AgentChannelConnection"("workspaceId", "userId", "channel", "accountId");

-- CreateIndex
CREATE INDEX "AgentRun_agentProfileId_createdAt_idx" ON "AgentRun"("agentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_workspaceId_idempotencyKey_key" ON "AgentRun"("workspaceId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelConnection" ADD CONSTRAINT "AgentChannelConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelConnection" ADD CONSTRAINT "AgentChannelConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelConnection" ADD CONSTRAINT "AgentChannelConnection_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
