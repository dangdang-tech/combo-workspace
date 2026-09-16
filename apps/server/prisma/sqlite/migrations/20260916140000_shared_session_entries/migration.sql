-- CreateTable
CREATE TABLE "SharedSessionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inviteTokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SharedSessionEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedSessionEntry_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedSessionEntry_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SharedSessionEntryMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "sessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SharedSessionEntryMember_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "SharedSessionEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedSessionEntryMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedSessionEntryMember_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SessionShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryMemberId" TEXT,
    "sessionId" TEXT NOT NULL,
    "sharedByUserId" TEXT NOT NULL,
    "sharedWithUserId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'view',
    "canApprovePermissions" BOOLEAN NOT NULL DEFAULT false,
    "encryptedDataKey" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionShare_entryMemberId_fkey" FOREIGN KEY ("entryMemberId") REFERENCES "SharedSessionEntryMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionShare_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionShare_sharedByUserId_fkey" FOREIGN KEY ("sharedByUserId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SessionShare" ("accessLevel", "canApprovePermissions", "createdAt", "encryptedDataKey", "id", "sessionId", "sharedByUserId", "sharedWithUserId", "updatedAt") SELECT "accessLevel", "canApprovePermissions", "createdAt", "encryptedDataKey", "id", "sessionId", "sharedByUserId", "sharedWithUserId", "updatedAt" FROM "SessionShare";
DROP TABLE "SessionShare";
ALTER TABLE "new_SessionShare" RENAME TO "SessionShare";
CREATE UNIQUE INDEX "SessionShare_entryMemberId_key" ON "SessionShare"("entryMemberId");
CREATE INDEX "SessionShare_sharedWithUserId_idx" ON "SessionShare"("sharedWithUserId");
CREATE INDEX "SessionShare_sharedByUserId_idx" ON "SessionShare"("sharedByUserId");
CREATE INDEX "SessionShare_sessionId_idx" ON "SessionShare"("sessionId");
CREATE UNIQUE INDEX "SessionShare_sessionId_sharedWithUserId_key" ON "SessionShare"("sessionId", "sharedWithUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
