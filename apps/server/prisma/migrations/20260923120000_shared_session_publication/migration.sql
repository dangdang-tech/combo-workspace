-- Nullable additions preserve existing hash-only invitations and their members.
ALTER TABLE "SharedSessionEntry" ADD COLUMN "publicMetadata" JSONB;
ALTER TABLE "SharedSessionEntry" ADD COLUMN "inviteTokenEncrypted" BYTEA;
