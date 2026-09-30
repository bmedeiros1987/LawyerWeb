-- CreateTable
CREATE TABLE "AgentExternalIdentity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelConnectionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT,
    "externalChatId" TEXT,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChannelEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelConnectionId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AgentChannelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentExternalIdentity_channelConnectionId_externalChatId_idx" ON "AgentExternalIdentity"("channelConnectionId", "externalChatId");

-- CreateIndex
CREATE INDEX "AgentExternalIdentity_pairingCodeHash_pairingExpiresAt_idx" ON "AgentExternalIdentity"("pairingCodeHash", "pairingExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExternalIdentity_channelConnectionId_userId_key" ON "AgentExternalIdentity"("channelConnectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExternalIdentity_channelConnectionId_externalUserId_key" ON "AgentExternalIdentity"("channelConnectionId", "externalUserId");

-- CreateIndex
CREATE INDEX "AgentChannelEvent_workspaceId_channel_receivedAt_idx" ON "AgentChannelEvent"("workspaceId", "channel", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentChannelEvent_channelConnectionId_externalEventId_key" ON "AgentChannelEvent"("channelConnectionId", "externalEventId");

-- AddForeignKey
ALTER TABLE "AgentExternalIdentity" ADD CONSTRAINT "AgentExternalIdentity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExternalIdentity" ADD CONSTRAINT "AgentExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExternalIdentity" ADD CONSTRAINT "AgentExternalIdentity_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "AgentChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelEvent" ADD CONSTRAINT "AgentChannelEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChannelEvent" ADD CONSTRAINT "AgentChannelEvent_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "AgentChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
