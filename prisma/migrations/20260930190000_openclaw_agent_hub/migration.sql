-- CreateTable
CREATE TABLE "OpenClawConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "gatewayUrl" TEXT NOT NULL,
    "gatewayTokenEnc" TEXT NOT NULL,
    "agentId" TEXT NOT NULL DEFAULT 'mblz',
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "version" TEXT,
    "lastHealthAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenClawConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChannelConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "secretEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "externalIdentity" TEXT,
    "config" JSONB,
    "connectedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChannelPreference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChannelPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openClawConnectionId" TEXT NOT NULL,
    "channelConnectionId" TEXT,
    "channel" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenClawConnection_workspaceId_key" ON "OpenClawConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "AgentChannelConnection_workspaceId_channel_status_idx" ON "AgentChannelConnection"("workspaceId", "channel", "status");

-- CreateIndex
CREATE INDEX "AgentChannelConnection_userId_channel_idx" ON "AgentChannelConnection"("userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "AgentChannelConnection_workspaceId_channel_accountKey_key" ON "AgentChannelConnection"("workspaceId", "channel", "accountKey");

-- CreateIndex
CREATE INDEX "AgentChannelPreference_userId_enabled_idx" ON "AgentChannelPreference"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AgentChannelPreference_workspaceId_userId_channel_key" ON "AgentChannelPreference"("workspaceId", "userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConversation_sessionKey_key" ON "AgentConversation"("sessionKey");

-- CreateIndex
CREATE INDEX "AgentConversation_workspaceId_lastMessageAt_idx" ON "AgentConversation"("workspaceId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConversation_workspaceId_userId_channel_externalThread_key" ON "AgentConversation"("workspaceId", "userId", "channel", "externalThreadId");

-- AddForeignKey
ALTER TABLE "OpenClawConnection" ADD CONSTRAINT "OpenClawConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelConnection" ADD CONSTRAINT "AgentChannelConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelConnection" ADD CONSTRAINT "AgentChannelConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelPreference" ADD CONSTRAINT "AgentChannelPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelPreference" ADD CONSTRAINT "AgentChannelPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_openClawConnectionId_fkey" FOREIGN KEY ("openClawConnectionId") REFERENCES "OpenClawConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "AgentChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
