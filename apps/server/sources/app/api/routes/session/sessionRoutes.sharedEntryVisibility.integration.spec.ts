import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { sharedSessionEntryRoutes } from "../share/sharedSessionEntryRoutes";
import { registerSessionListingRoutes } from "./registerSessionListingRoutes";
import { createV2SessionListVisibilityArmsReader, findV2SessionListRows, V2_SESSION_LIST_ORDER_BY } from "./v2SessionListPage";

const readers = [
    ["legacy list", () => "/v1/sessions"],
    ["paged list", () => "/v2/sessions"],
    ["active list", () => "/v2/sessions/active"],
    ["initial list", () => "/v2/sessions?includeAttention=true&includeActive=true"],
    ["detail", (sessionId: string) => `/v2/sessions/${sessionId}`],
] as const;

describe("managed entry visibility through legacy session readers", () => {
    let harness: LightSqliteHarness;
    const app = Fastify().withTypeProvider<ZodTypeProvider>();

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-entry-list-visibility-", initAuth: false,
            env: { HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED: "1" },
        });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate("authenticate", async (request: FastifyRequest) => {
            request.userId = String(request.headers["x-test-user-id"] ?? "");
        });
        registerSessionListingRoutes(app);
        sharedSessionEntryRoutes(app);
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app.close();
        await harness?.close();
    });

    async function seed() {
        const suffix = randomUUID();
        const owner = await db.account.create({ data: { publicKey: `owner-${suffix}` } });
        const guest = await db.account.create({ data: { publicKey: `guest-${suffix}` } });
        const stranger = await db.account.create({ data: { publicKey: `stranger-${suffix}` } });
        const machine = await db.machine.create({ data: { id: `machine-${suffix}`, accountId: owner.id, metadata: "opaque" } });
        const source = await db.session.create({ data: { accountId: owner.id, tag: `source-${suffix}`, metadata: "source" } });
        const metadata = `private-metadata-${suffix}`;
        const agentState = `private-agent-state-${suffix}`;
        const child = await db.session.create({ data: {
            accountId: owner.id, tag: `child-${suffix}`, metadata, agentState,
            encryptionMode: "e2ee", active: true, lastActiveAt: new Date(),
            dataEncryptionKey: new Uint8Array([4, 5, 6]),
        } });
        const entry = await db.sharedSessionEntry.create({ data: {
            ownerId: owner.id, sourceSessionId: source.id, machineId: machine.id,
            title: "Private child", inviteTokenHash: suffix,
        } });
        const member = await db.sharedSessionEntryMember.create({ data: {
            entryId: entry.id, userId: guest.id, sessionId: child.id, enabled: true, status: "ready",
        } });
        const encryptedDataKey = new Uint8Array(Buffer.from(`private-recipient-key-${suffix}`));
        await db.sessionShare.create({ data: {
            entryMemberId: member.id, sessionId: child.id, sharedByUserId: owner.id,
            sharedWithUserId: guest.id, accessLevel: "edit", encryptedDataKey,
        } });
        return { owner, guest, stranger, child, entry, member, metadata, agentState, encryptedDataKey };
    }

    for (const scenario of ["wrong member", "revoked with rebuilt grant", "reprovisioning"] as const) {
        it.each(readers)(`denies ${scenario} through %s without returning metadata or DEK`, async (reader, url) => {
            const fixture = await seed();
            let viewerId = fixture.guest.id;
            if (scenario === "wrong member") {
                viewerId = fixture.stranger.id;
                await db.sessionShare.create({ data: {
                    sessionId: fixture.child.id, sharedByUserId: fixture.owner.id, sharedWithUserId: viewerId,
                    accessLevel: "admin", canApprovePermissions: true, encryptedDataKey: fixture.encryptedDataKey,
                } });
            } else if (scenario === "revoked with rebuilt grant") {
                const revoke = await app.inject({ method: "PATCH",
                    url: `/v1/shared-session-entries/${fixture.entry.id}/members/${fixture.member.id}`,
                    headers: { "x-test-user-id": fixture.owner.id }, payload: { enabled: false },
                });
                expect(revoke.statusCode).toBe(200);
                expect(await db.sessionShare.count({ where: { sessionId: fixture.child.id } })).toBe(0);
                // An older share writer can recreate a grant without the managed entry relation.
                await db.sessionShare.create({ data: {
                    sessionId: fixture.child.id, sharedByUserId: fixture.owner.id, sharedWithUserId: viewerId,
                    accessLevel: "edit", encryptedDataKey: fixture.encryptedDataKey,
                } });
            } else {
                await db.sharedSessionEntryMember.update({ where: { id: fixture.member.id }, data: { status: "provisioning" } });
            }

            const response = await app.inject({ method: "GET", url: url(fixture.child.id), headers: { "x-test-user-id": viewerId } });
            expect(response.statusCode).toBe(reader === "detail" ? 404 : 200);
            expect(response.body).not.toContain(fixture.child.id);
            expect(response.body).not.toContain(fixture.metadata);
            expect(response.body).not.toContain(fixture.agentState);
            expect(response.body).not.toContain(Buffer.from(fixture.encryptedDataKey).toString("base64"));
        });
    }

    it("rechecks membership when an initial-page read reuses previously resolved shared ids", async () => {
        const fixture = await seed();
        const visibilityArms = createV2SessionListVisibilityArmsReader(fixture.guest.id);
        await visibilityArms();
        await db.sharedSessionEntryMember.update({ where: { id: fixture.member.id }, data: { enabled: false, status: "revoked" } });
        const rows = await findV2SessionListRows({ userId: fixture.guest.id, orderBy: V2_SESSION_LIST_ORDER_BY, visibilityArms });
        expect(rows).toEqual([]);
    });

    it.each(["assigned member", "ordinary share", "owner after revocation"] as const)("preserves %s visibility in every reader", async (scenario) => {
        const fixture = await seed();
        let viewerId = fixture.guest.id;
        if (scenario === "ordinary share") {
            const ordinary = await db.session.create({ data: {
                accountId: fixture.owner.id, tag: `ordinary-${randomUUID()}`, metadata: fixture.metadata,
                active: true, lastActiveAt: new Date(),
                shares: { create: { sharedByUserId: fixture.owner.id, sharedWithUserId: viewerId,
                    accessLevel: "view", encryptedDataKey: fixture.encryptedDataKey } },
            } });
            fixture.child = ordinary;
        } else if (scenario === "owner after revocation") {
            viewerId = fixture.owner.id;
            await db.sharedSessionEntryMember.update({ where: { id: fixture.member.id }, data: { enabled: false, status: "revoked" } });
        }
        for (const [, url] of readers) {
            const response = await app.inject({ method: "GET", url: url(fixture.child.id), headers: { "x-test-user-id": viewerId } });
            expect(response.statusCode).toBe(200);
            expect(response.body).toContain(fixture.child.id);
            expect(response.body).toContain(fixture.metadata);
            if (viewerId === fixture.guest.id) expect(response.body).toContain(Buffer.from(fixture.encryptedDataKey).toString("base64"));
        }
    });
});
