-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterParty" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'OTHER',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterPhase" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT,
    "court" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "requestId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterMovement" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "phaseId" TEXT,
    "communicationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_clientId_key" ON "Person"("clientId");

-- CreateIndex
CREATE INDEX "Person_workspaceId_name_idx" ON "Person"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MatterParty_matterId_personId_role_key" ON "MatterParty"("matterId", "personId", "role");

-- CreateIndex
CREATE INDEX "MatterPhase_matterId_startedAt_idx" ON "MatterPhase"("matterId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatterPhase_matterId_requestId_key" ON "MatterPhase"("matterId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "MatterMovement_communicationId_key" ON "MatterMovement"("communicationId");

-- CreateIndex
CREATE INDEX "MatterMovement_matterId_occurredAt_idx" ON "MatterMovement"("matterId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatterMovement_matterId_source_externalId_key" ON "MatterMovement"("matterId", "source", "externalId");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterParty" ADD CONSTRAINT "MatterParty_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterParty" ADD CONSTRAINT "MatterParty_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterPhase" ADD CONSTRAINT "MatterPhase_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterMovement" ADD CONSTRAINT "MatterMovement_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterMovement" ADD CONSTRAINT "MatterMovement_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "MatterPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterMovement" ADD CONSTRAINT "MatterMovement_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "CourtCommunication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
