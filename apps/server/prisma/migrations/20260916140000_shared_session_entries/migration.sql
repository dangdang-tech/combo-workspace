-- AlterTable
ALTER TABLE "SessionShare" ADD COLUMN     "entryMemberId" TEXT;

-- CreateTable
CREATE TABLE "SharedSessionEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inviteTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedSessionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedSessionEntryMember" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedSessionEntryMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedSessionEntry_inviteTokenHash_key" ON "SharedSessionEntry"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "SharedSessionEntry_ownerId_createdAt_idx" ON "SharedSessionEntry"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "SharedSessionEntry_machineId_idx" ON "SharedSessionEntry"("machineId");

-- CreateIndex
CREATE INDEX "SharedSessionEntry_sourceSessionId_idx" ON "SharedSessionEntry"("sourceSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedSessionEntryMember_sessionId_key" ON "SharedSessionEntryMember"("sessionId");

-- CreateIndex
CREATE INDEX "SharedSessionEntryMember_entryId_status_createdAt_idx" ON "SharedSessionEntryMember"("entryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SharedSessionEntryMember_userId_idx" ON "SharedSessionEntryMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedSessionEntryMember_entryId_userId_key" ON "SharedSessionEntryMember"("entryId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionShare_entryMemberId_key" ON "SessionShare"("entryMemberId");

-- AddForeignKey
ALTER TABLE "SessionShare" ADD CONSTRAINT "SessionShare_entryMemberId_fkey" FOREIGN KEY ("entryMemberId") REFERENCES "SharedSessionEntryMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSessionEntry" ADD CONSTRAINT "SharedSessionEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSessionEntry" ADD CONSTRAINT "SharedSessionEntry_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSessionEntry" ADD CONSTRAINT "SharedSessionEntry_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSessionEntryMember" ADD CONSTRAINT "SharedSessionEntryMember_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "SharedSessionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSessionEntryMember" ADD CONSTRAINT "SharedSessionEntryMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSessionEntryMember" ADD CONSTRAINT "SharedSessionEntryMember_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
