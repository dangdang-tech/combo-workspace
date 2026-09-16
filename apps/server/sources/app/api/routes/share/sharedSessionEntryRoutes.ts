import type { Fastify } from "../../types";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import * as privacyKit from "privacy-kit";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createServerFeatureGatedRouteApp } from "@/app/features/catalog/serverFeatureGate";
import { checkSessionAccess } from "@/app/share/accessControl";
import {
    assertGoogleIdentity, assertHostOnline, ENTRY_INCLUDE, findEntry, grantEntrySession, hashInvite,
    MEMBER_INCLUDE, memberAccess, memberSummary, newInvite, parseEntryDataKey, publicEntry,
    revokeEntrySession, SessionEntryError,
} from "@/app/share/sessionEntryService";
import { SESSION_ENTRY_MACHINE_SELECT } from "@/app/share/sessionEntryPresence";

async function respond(reply: FastifyReply, work: () => Promise<unknown>) {
    try { return reply.send(await work()); }
    catch (error) {
        if (error instanceof SessionEntryError) return reply.code(error.status).send({ error: error.code });
        throw error;
    }
}
const entryParams = z.object({ entryId: z.string().min(1) });
const memberParams = entryParams.extend({ memberId: z.string().min(1) });
const machineParams = z.object({ machineId: z.string().min(1) });
const assignmentParams = machineParams.extend({ memberId: z.string().min(1) });

export function sharedSessionEntryRoutes(baseApp: Fastify): void {
    const app = createServerFeatureGatedRouteApp(baseApp, "sharing.sessionEntries");
    app.post("/v1/shared-session-entries", {
        preHandler: app.authenticate,
        schema: { body: z.object({ title: z.string().trim().min(1).max(120), sourceSessionId: z.string().min(1), machineId: z.string().min(1) }).strict() },
    }, (request, reply) => respond(reply, async () => {
        const invite = newInvite();
        const entry = await inTx(async (tx) => {
            const [source, machine] = await Promise.all([
                tx.session.findUnique({ where: { id: request.body.sourceSessionId }, select: { accountId: true, encryptionMode: true, dataEncryptionKey: true, sharedSessionEntryMember: { select: { id: true } } } }),
                tx.machine.findUnique({ where: { id: request.body.machineId }, select: SESSION_ENTRY_MACHINE_SELECT }),
            ]);
            if (source?.accountId !== request.userId || machine?.accountId !== request.userId || source.sharedSessionEntryMember) throw new SessionEntryError(403, "forbidden");
            if (source.encryptionMode !== "plain" && !source.dataEncryptionKey) throw new SessionEntryError(409, "encryption_upgrade_required");
            if (machine.revokedAt || machine.replacedByMachineId) throw new SessionEntryError(409, "host_offline");
            return tx.sharedSessionEntry.create({ data: { ...request.body, ownerId: request.userId, inviteTokenHash: invite.hash } });
        });
        return { entry: publicEntry(entry), inviteToken: invite.token };
    }));

    app.get("/v1/shared-session-entries", { preHandler: app.authenticate }, (request, reply) => respond(reply, async () => ({
        entries: (await db.sharedSessionEntry.findMany({ where: { ownerId: request.userId }, orderBy: { createdAt: "desc" } })).map(publicEntry),
    })));

    app.post("/v1/shared-session-entries/:entryId/invite", { preHandler: app.authenticate, schema: { params: entryParams } }, (request, reply) => respond(reply, async () => {
        const invite = newInvite();
        const result = await db.sharedSessionEntry.updateMany({ where: { id: request.params.entryId, ownerId: request.userId }, data: { inviteTokenHash: invite.hash } });
        if (result.count !== 1) throw new SessionEntryError(403, "forbidden");
        return { inviteToken: invite.token };
    }));

    app.post("/v1/shared-session-entries/redeem", {
        preHandler: app.authenticate, schema: { body: z.object({ inviteToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict() },
    }, (request, reply) => respond(reply, async () => {
        const member = await inTx(async (tx) => {
            await assertGoogleIdentity(request.userId, tx);
            const entry = await tx.sharedSessionEntry.findUnique({ where: { inviteTokenHash: hashInvite(request.body.inviteToken) }, include: ENTRY_INCLUDE });
            if (!entry) throw new SessionEntryError(404, "invite_not_found");
            if (entry.ownerId === request.userId) throw new SessionEntryError(403, "forbidden");
            const existing = await tx.sharedSessionEntryMember.findUnique({ where: { entryId_userId: { entryId: entry.id, userId: request.userId } }, include: MEMBER_INCLUDE });
            if (existing && !existing.enabled) throw new SessionEntryError(403, "shared_session_access_revoked");
            if (existing && existing.status !== "failed") return existing;
            assertHostOnline(entry);
            if (entry.sourceSession.encryptionMode !== "plain") {
                const recipient = await tx.account.findUnique({ where: { id: request.userId }, select: { contentPublicKey: true, contentPublicKeySig: true } });
                if (!recipient?.contentPublicKey || !recipient.contentPublicKeySig) throw new SessionEntryError(409, "content_keys_required");
            }
            return tx.sharedSessionEntryMember.upsert({
                where: { entryId_userId: { entryId: entry.id, userId: request.userId } },
                create: { entryId: entry.id, userId: request.userId }, update: { status: "pending", errorCode: null }, include: MEMBER_INCLUDE,
            });
        });
        return { access: memberAccess(member) };
    }));

    app.get("/v1/shared-session-entries/:entryId/access", { preHandler: app.authenticate, schema: { params: entryParams } }, (request, reply) => respond(reply, async () => {
        const member = await db.sharedSessionEntryMember.findUnique({ where: { entryId_userId: { entryId: request.params.entryId, userId: request.userId } }, include: MEMBER_INCLUDE });
        if (!member) throw new SessionEntryError(403, "forbidden");
        return { access: memberAccess(member) };
    }));

    app.get("/v1/sessions/:sessionId/shared-session-entry-access", { preHandler: app.authenticate, schema: { params: z.object({ sessionId: z.string().min(1) }) } }, (request, reply) => respond(reply, async () => {
        const member = await db.sharedSessionEntryMember.findUnique({ where: { sessionId: request.params.sessionId }, include: MEMBER_INCLUDE });
        if (member && member.userId === request.userId && !member.enabled) throw new SessionEntryError(403, "shared_session_access_revoked");
        if (!await checkSessionAccess(request.userId, request.params.sessionId)) throw new SessionEntryError(403, "forbidden");
        return { access: member ? memberAccess(member) : null };
    }));

    app.get("/v1/shared-session-entries/:entryId/members", { preHandler: app.authenticate, schema: { params: entryParams } }, (request, reply) => respond(reply, async () => {
        const entry = await findEntry(request.params.entryId);
        if (entry?.ownerId !== request.userId) throw new SessionEntryError(403, "forbidden");
        return { members: (await db.sharedSessionEntryMember.findMany({ where: { entryId: entry.id }, include: MEMBER_INCLUDE, orderBy: { createdAt: "asc" } })).map(memberSummary) };
    }));

    app.patch("/v1/shared-session-entries/:entryId/members/:memberId", {
        preHandler: app.authenticate, schema: { params: memberParams, body: z.object({ enabled: z.boolean() }).strict() },
    }, (request, reply) => respond(reply, async () => {
        const member = await inTx(async (tx) => {
            const existing = await tx.sharedSessionEntryMember.findUnique({ where: { id: request.params.memberId }, include: MEMBER_INCLUDE });
            if (!existing || existing.entryId !== request.params.entryId || existing.entry.ownerId !== request.userId) throw new SessionEntryError(403, "forbidden");
            if (existing.enabled === request.body.enabled) return existing;
            if (!request.body.enabled) await revokeEntrySession(tx, existing);
            else assertHostOnline(existing.entry);
            return tx.sharedSessionEntryMember.update({ where: { id: existing.id }, data: { enabled: request.body.enabled, status: request.body.enabled ? "pending" : "revoked", errorCode: null }, include: MEMBER_INCLUDE });
        });
        return { member: memberSummary(member) };
    }));

    app.post("/v1/machines/:machineId/shared-session-entries/claim", { preHandler: app.authenticate, schema: { params: machineParams } }, (request, reply) => respond(reply, async () => {
        const assignment = await inTx(async (tx) => {
            const machine = await tx.machine.findUnique({ where: { id: request.params.machineId }, select: SESSION_ENTRY_MACHINE_SELECT });
            if (!machine || machine.accountId !== request.userId) throw new SessionEntryError(403, "forbidden");
            assertHostOnline({ machine });
            const member = await tx.sharedSessionEntryMember.findFirst({
                where: { enabled: true, status: { in: ["pending", "provisioning"] }, entry: { machineId: machine.id, ownerId: request.userId } },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { ...MEMBER_INCLUDE, user: { select: { publicKey: true, contentPublicKey: true, contentPublicKeySig: true } } },
            });
            if (!member) return null;
            await tx.sharedSessionEntryMember.update({ where: { id: member.id }, data: { status: "provisioning" } });
            return {
                entryId: member.entryId, memberId: member.id, sourceSessionId: member.entry.sourceSessionId,
                sessionId: member.sessionId, encryptionMode: member.entry.sourceSession.encryptionMode === "plain" ? "plain" : "e2ee",
                recipient: {
                    userId: member.userId, signingPublicKey: member.user.publicKey,
                    contentPublicKeyB64: member.user.contentPublicKey ? privacyKit.encodeBase64(new Uint8Array(member.user.contentPublicKey)) : null,
                    contentPublicKeySigB64: member.user.contentPublicKeySig ? privacyKit.encodeBase64(new Uint8Array(member.user.contentPublicKeySig)) : null,
                },
            };
        });
        return { assignment };
    }));

    app.post("/v1/machines/:machineId/shared-session-entries/:memberId/complete", {
        preHandler: app.authenticate, schema: { params: assignmentParams, body: z.object({ sessionId: z.string().min(1), encryptedDataKey: z.string().max(4096).optional() }).strict() },
    }, (request, reply) => respond(reply, async () => {
        await inTx(async (tx) => {
            const member = await tx.sharedSessionEntryMember.findUnique({ where: { id: request.params.memberId }, include: MEMBER_INCLUDE });
            if (!member || member.entry.ownerId !== request.userId || member.entry.machineId !== request.params.machineId) throw new SessionEntryError(403, "forbidden");
            if (!member.enabled) throw new SessionEntryError(403, "shared_session_access_revoked");
            if (member.status === "ready" && member.sessionId === request.body.sessionId) return;
            if (member.status !== "provisioning") throw new SessionEntryError(409, "assignment_not_claimed");
            assertHostOnline(member.entry);
            const child = await tx.session.findUnique({ where: { id: request.body.sessionId }, select: { accountId: true, encryptionMode: true, dataEncryptionKey: true, sharedSessionEntryMember: { select: { id: true } }, sharedSessionEntries: { select: { id: true }, take: 1 } } });
            if (!child || child.accountId !== request.userId || request.body.sessionId === member.entry.sourceSessionId
                || (member.sessionId && member.sessionId !== request.body.sessionId)
                || (child.sharedSessionEntryMember && child.sharedSessionEntryMember.id !== member.id)
                || child.sharedSessionEntries.length > 0) throw new SessionEntryError(409, "invalid_child_session");
            if (child.encryptionMode !== member.entry.sourceSession.encryptionMode) throw new SessionEntryError(409, "encryption_mode_mismatch");
            const encryptedDataKey = child.encryptionMode === "plain" ? null : parseEntryDataKey(request.body.encryptedDataKey);
            if (child.encryptionMode !== "plain" && !child.dataEncryptionKey) throw new SessionEntryError(409, "encryption_upgrade_required");
            await tx.sharedSessionEntryMember.update({ where: { id: member.id }, data: { sessionId: request.body.sessionId, status: "ready", errorCode: null } });
            await grantEntrySession(tx, member, request.body.sessionId, encryptedDataKey);
        });
        return { ok: true };
    }));

    app.post("/v1/machines/:machineId/shared-session-entries/:memberId/fail", {
        preHandler: app.authenticate, schema: { params: assignmentParams, body: z.object({ errorCode: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/) }).strict() },
    }, (request, reply) => respond(reply, async () => {
        const result = await db.sharedSessionEntryMember.updateMany({
            where: { id: request.params.memberId, enabled: true, status: "provisioning", entry: { ownerId: request.userId, machineId: request.params.machineId } },
            data: { status: "failed", errorCode: request.body.errorCode },
        });
        if (result.count !== 1) throw new SessionEntryError(403, "forbidden");
        return { ok: true };
    }));
}
