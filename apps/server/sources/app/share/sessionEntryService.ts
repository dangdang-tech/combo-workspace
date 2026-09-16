import { createHash, randomBytes } from "node:crypto";
import * as privacyKit from "privacy-kit";
import { ENCRYPTED_DATA_KEY_ENVELOPE_V1_VERSION_BYTE } from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { afterTx, type Tx } from "@/storage/inTx";
import { markAccountChanged } from "@/app/changes/markAccountChanged";
import { eventRouter, buildSessionSharedUpdate, buildSessionShareRevokedUpdate } from "@/app/events/eventRouter";
import { invalidateSessionRelayAuthorizationForSession } from "@/app/api/socket/sessionRelayAuthCache";
import { tombstoneSessionDraftForLifecycleInTx } from "@/app/account/sessionDrafts/sessionDraftService";
import { PROFILE_SELECT } from "./types";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import { isSessionEntryHostLive, SESSION_ENTRY_MACHINE_SELECT } from "./sessionEntryPresence";

export class SessionEntryError extends Error {
    constructor(readonly status: 400 | 403 | 404 | 409, readonly code: string) { super(code); }
}

export const ENTRY_INCLUDE = {
    machine: { select: SESSION_ENTRY_MACHINE_SELECT },
    sourceSession: { select: { encryptionMode: true, dataEncryptionKey: true } },
} as const;

export const MEMBER_INCLUDE = { entry: { include: ENTRY_INCLUDE }, user: { select: { username: true } } } as const;

type Entry = NonNullable<Awaited<ReturnType<typeof findEntry>>>;
export function findEntry(id: string) { return db.sharedSessionEntry.findUnique({ where: { id }, include: ENTRY_INCLUDE }); }
type Member = NonNullable<Awaited<ReturnType<typeof findMember>>>;
export function findMember(id: string) { return db.sharedSessionEntryMember.findUnique({ where: { id }, include: MEMBER_INCLUDE }); }

export function newInvite() {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: hashInvite(token) };
}
export function hashInvite(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function publicEntry(entry: Pick<Entry, "id" | "title" | "sourceSessionId" | "machineId" | "createdAt">) {
    return { id: entry.id, title: entry.title, sourceSessionId: entry.sourceSessionId, machineId: entry.machineId, createdAt: entry.createdAt.getTime() };
}
export function memberSummary(member: Member) {
    return { id: member.id, userId: member.userId, username: member.user.username, status: member.enabled ? member.status : "revoked", enabled: member.enabled, sessionId: member.sessionId, errorCode: member.errorCode };
}
export function memberAccess(member: Member) {
    return {
        entryId: member.entryId, title: member.entry.title, memberId: member.id,
        status: member.enabled ? member.status : "revoked",
        sessionId: member.enabled && member.status === "ready" ? member.sessionId : null,
        hostOnline: isSessionEntryHostLive(member.entry.machine), errorCode: member.errorCode,
    };
}

export async function assertGoogleIdentity(userId: string, tx: Tx = db) {
    const identity = await tx.accountIdentity.findFirst({ where: { accountId: userId, provider: "google" }, select: { profile: true } });
    const profile = identity?.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)
        || !("email_verified" in profile) || profile.email_verified !== true
        || !("email" in profile) || typeof profile.email !== "string" || !profile.email.trim()) {
        throw new SessionEntryError(403, "google_identity_required");
    }
}

export function assertHostOnline(entry: Pick<Entry, "machine">) {
    if (!isSessionEntryHostLive(entry.machine)) throw new SessionEntryError(409, "host_offline");
}

export function parseEntryDataKey(value: string | undefined): Uint8Array<ArrayBuffer> {
    if (!value) throw new SessionEntryError(400, "encrypted_data_key_required");
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = new Uint8Array(privacyKit.decodeBase64(value)); }
    catch { throw new SessionEntryError(400, "invalid_encrypted_data_key"); }
    // Canonical v1 envelope contains one independent 32-byte session DEK.
    if (bytes.length !== 105 || bytes[0] !== ENCRYPTED_DATA_KEY_ENVELOPE_V1_VERSION_BYTE || privacyKit.encodeBase64(bytes) !== value) {
        throw new SessionEntryError(400, "invalid_encrypted_data_key");
    }
    return bytes;
}

async function markShareChanged(tx: Tx, ownerId: string, userId: string, sessionId: string) {
    await markAccountChanged(tx, { accountId: ownerId, kind: "share", entityId: sessionId });
    const shareCursor = await markAccountChanged(tx, { accountId: userId, kind: "share", entityId: sessionId });
    const sessionCursor = await markAccountChanged(tx, { accountId: userId, kind: "session", entityId: sessionId });
    return Math.max(shareCursor, sessionCursor);
}

/** Materialize a private edit-only grant and notify the recipient after commit. */
export async function grantEntrySession(tx: Tx, member: Member, sessionId: string, encryptedDataKey: Uint8Array<ArrayBuffer> | null) {
    const data = {
        entryMemberId: member.id, sharedByUserId: member.entry.ownerId, accessLevel: "edit" as const,
        canApprovePermissions: false, encryptedDataKey,
    };
    const share = await tx.sessionShare.upsert({
        where: { sessionId_sharedWithUserId: { sessionId, sharedWithUserId: member.userId } },
        create: { ...data, sessionId, sharedWithUserId: member.userId }, update: data,
        include: { sharedWithUser: { select: PROFILE_SELECT }, sharedByUser: { select: PROFILE_SELECT } },
    });
    const cursor = await markShareChanged(tx, member.entry.ownerId, member.userId, sessionId);
    afterTx(tx, () => {
        invalidateSessionRelayAuthorizationForSession(sessionId);
        eventRouter.emitUpdate({ userId: member.userId, payload: buildSessionSharedUpdate(share, cursor, randomKeyNaked(12)), recipientFilter: { type: "all-user-authenticated-connections" } });
    });
}

/** Revoke the durable grant, invalidate draft/relay access, and retain the host's child conversation. */
export async function revokeEntrySession(tx: Tx, member: Member) {
    if (!member.sessionId) return;
    const share = await tx.sessionShare.findUnique({ where: { entryMemberId: member.id } });
    if (share) await tx.sessionShare.delete({ where: { id: share.id } });
    await tombstoneSessionDraftForLifecycleInTx(tx, { accountId: member.userId, sessionId: member.sessionId });
    const cursor = await markShareChanged(tx, member.entry.ownerId, member.userId, member.sessionId);
    const sessionId = member.sessionId;
    afterTx(tx, () => {
        invalidateSessionRelayAuthorizationForSession(sessionId);
        if (share) eventRouter.emitUpdate({ userId: member.userId, payload: buildSessionShareRevokedUpdate(share.id, sessionId, cursor, randomKeyNaked(12)), recipientFilter: { type: "all-user-authenticated-connections" } });
    });
}
