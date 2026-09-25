-- Nullable additions preserve existing hash-only invitations and their members.
ALTER TABLE `SharedSessionEntry` ADD COLUMN `publicMetadata` JSON;
ALTER TABLE `SharedSessionEntry` ADD COLUMN `inviteTokenEncrypted` LONGBLOB;
