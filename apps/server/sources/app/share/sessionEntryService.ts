import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { decryptString, encryptString } from "@/modules/encrypt";
import * as privacyKit from "privacy-kit";
import { ENCRYPTED_DATA_KEY_ENVELOPE_V1_VERSION_BYTE } from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { afterTx, type Tx } from "@/storage/inTx";
import { markAccountChanged } from "@/app/changes/markAccountChanged";
import { eventRouter, buildSessionSharedUpdate, buildSessionShareRevokedUpdate } from "@/app/events/eventRouter";
import { invalidateSessionRelayAuthorizationForSession } from "@/app/api/socket/sessionRelayAuthCache";
import { PROFILE_SELECT } from "./types";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import { isSessionEntryHostLive, SESSION_ENTRY_MACHINE_SELECT } from "./sessionEntryPresence";

export class SessionEntryError extends Error {
    constructor(readonly status: 400 | 403 | 404 | 409, readonly code: string) { super(code); }
}

export const ENTRY_INCLUDE = {
    machine: { select: SESSION_ENTRY_MACHINE_SELECT },
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
export const entryInviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const entryPublicMetadataSchema = z.object({
    v: z.literal(1),
    description: z.string().trim().max(1000).optional(),
    publisherDisplayName: z.string().trim().max(80).optional(),
}).strict();

function readPublicMetadata(value: unknown) {
    const parsed = entryPublicMetadataSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
function inviteEncryptionPath(entry: Pick<Entry, "id" | "ownerId">) {
    return ["share", "session-entry", entry.ownerId, entry.id, "invite", "v1"];
}
export function encryptEntryInvite(entry: Pick<Entry, "id" | "ownerId">, token: string) {
    return encryptString(inviteEncryptionPath(entry), token);
}
/** Recovery never rotates an invitation or invents a secret for a legacy hash-only row. */
export function recoverEntryInvite(entry: Pick<Entry, "id" | "ownerId" | "inviteTokenHash" | "inviteTokenEncrypted">): string {
    try {
        if (entry.inviteTokenEncrypted) {
            const token = decryptString(inviteEncryptionPath(entry), new Uint8Array(entry.inviteTokenEncrypted));
            if (typeof token === "string" && entryInviteTokenSchema.safeParse(token).success && hashInvite(token) === entry.inviteTokenHash) return token;
        }
    } catch { /* Missing or incompatible encryption material must fail closed without exposing it. */ }
    throw new SessionEntryError(409, "invite_secret_unavailable");
}
/** Owner-only summary; anonymous callers must use entryPreview instead. */
export function publicEntry(entry: Pick<Entry, "id" | "title" | "sourceSessionId" | "machineId" | "createdAt" | "sourceSnapshot" | "publicMetadata" | "inviteTokenEncrypted">) {
    return { id: entry.id, title: entry.title, sourceSessionId: entry.sourceSessionId, machineId: entry.machineId,
        createdAt: entry.createdAt.getTime(), hasContextSnapshot: Boolean(entry.sourceSnapshot),
        hasReusableInvite: Boolean(entry.inviteTokenEncrypted), publicMetadata: readPublicMetadata(entry.publicMetadata) };
}
export function entryPreview(entry: Pick<Entry, "title" | "publicMetadata">) {
    const metadata = readPublicMetadata(entry.publicMetadata);
    return { title: entry.title, description: metadata?.description || null, publisherDisplayName: metadata?.publisherDisplayName || null };
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

/** Provisioning follows the frozen source contract, never the source's current mode. */
export function entrySourceEncryptionMode(entry: Pick<Entry, "sourceSnapshot" | "sourceSessionId">): "plain" | "e2ee" {
    const snapshot = entry.sourceSnapshot;
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        && "v" in snapshot && snapshot.v === 1 && "session" in snapshot) {
        const session = snapshot.session;
        if (session && typeof session === "object" && !Array.isArray(session)
            && "id" in session && session.id === entry.sourceSessionId && "encryptionMode" in session
            && (session.encryptionMode === "plain" || session.encryptionMode === "e2ee")) {
            return session.encryptionMode;
        }
    }
    throw new SessionEntryError(409, "context_snapshot_required");
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

/** Suspend the grant and relay access, retaining the child's conversation and the guest's private draft for re-enablement. */
export async function revokeEntrySession(tx: Tx, member: Member) {
    if (!member.sessionId) return;
    const share = await tx.sessionShare.findUnique({ where: { entryMemberId: member.id } });
    if (share) await tx.sessionShare.delete({ where: { id: share.id } });
    const cursor = await markShareChanged(tx, member.entry.ownerId, member.userId, member.sessionId);
    const sessionId = member.sessionId;
    afterTx(tx, () => {
        invalidateSessionRelayAuthorizationForSession(sessionId);
        if (share) eventRouter.emitUpdate({ userId: member.userId, payload: buildSessionShareRevokedUpdate(share.id, sessionId, cursor, randomKeyNaked(12)), recipientFilter: { type: "all-user-authenticated-connections" } });
    });
}

/** Freeze stored message content and metadata without decrypting encrypted sessions. */
export async function captureEntrySourceSnapshot(tx: Tx, sourceSessionId: string) {
    const session = await tx.session.findUniqueOrThrow({ where: { id: sourceSessionId },
        select: { id: true, seq: true, metadata: true, encryptionMode: true, dataEncryptionKey: true } });
    const messages = await tx.sessionMessage.findMany({ where: { sessionId: sourceSessionId, seq: { lte: session.seq }, sidechainId: null },
        orderBy: { seq: "asc" }, take: 5_001, select: { seq: true, createdAt: true, content: true, messageRole: true } });
    const snapshot = { v: 1, session: { ...session,
        dataEncryptionKey: session.dataEncryptionKey ? privacyKit.encodeBase64(new Uint8Array(session.dataEncryptionKey)) : null },
        messages: messages.map((message) => ({ ...message, createdAt: message.createdAt.getTime() })) };
    // Refuse oversized shares; never silently replace a snapshot with a later live read.
    if (messages.length > 5_000 || Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 2_000_000) {
        throw new SessionEntryError(409, "context_snapshot_too_large");
    }
    return snapshot;
}
