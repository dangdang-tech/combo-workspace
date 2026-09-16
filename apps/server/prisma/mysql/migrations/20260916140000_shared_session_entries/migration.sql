-- AlterTable
ALTER TABLE `SessionShare` ADD COLUMN `entryMemberId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `SharedSessionEntry` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `sourceSessionId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `inviteTokenHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SharedSessionEntry_inviteTokenHash_key`(`inviteTokenHash`),
    INDEX `SharedSessionEntry_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    INDEX `SharedSessionEntry_machineId_idx`(`machineId`),
    INDEX `SharedSessionEntry_sourceSessionId_idx`(`sourceSessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedSessionEntryMember` (
    `id` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `errorCode` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SharedSessionEntryMember_sessionId_key`(`sessionId`),
    INDEX `SharedSessionEntryMember_entryId_status_createdAt_idx`(`entryId`, `status`, `createdAt`),
    INDEX `SharedSessionEntryMember_userId_idx`(`userId`),
    UNIQUE INDEX `SharedSessionEntryMember_entryId_userId_key`(`entryId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `SessionShare_entryMemberId_key` ON `SessionShare`(`entryMemberId`);

-- AddForeignKey
ALTER TABLE `SessionShare` ADD CONSTRAINT `SessionShare_entryMemberId_fkey` FOREIGN KEY (`entryMemberId`) REFERENCES `SharedSessionEntryMember`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedSessionEntry` ADD CONSTRAINT `SharedSessionEntry_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedSessionEntry` ADD CONSTRAINT `SharedSessionEntry_sourceSessionId_fkey` FOREIGN KEY (`sourceSessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedSessionEntry` ADD CONSTRAINT `SharedSessionEntry_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedSessionEntryMember` ADD CONSTRAINT `SharedSessionEntryMember_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `SharedSessionEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedSessionEntryMember` ADD CONSTRAINT `SharedSessionEntryMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedSessionEntryMember` ADD CONSTRAINT `SharedSessionEntryMember_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
