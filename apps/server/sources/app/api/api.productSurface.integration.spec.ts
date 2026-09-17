import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auth } from "@/app/auth/auth";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { registerApiRoutes } from "./api";
import { enableAuthentication } from "./utils/enableAuthentication";

describe("COMBO sharing API surface", () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    let harness: LightSqliteHarness;
    let authorization: string;
    let ownerId: string;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "combo-api-surface-",
            initAuth: true,
            initEncrypt: true,
            env: {
                HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED: "1",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
                AUTH_ANONYMOUS_SIGNUP_ENABLED: "true",
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_PROVIDERS_CONFIG_PATH: "",
                HAPPIER_BUILD_FEATURES_ALLOW: "",
                HAPPIER_BUILD_FEATURES_DENY: "",
                HAPPIER_FEATURE_POLICY_ENV: "",
                HAPPIER_EMBEDDED_POLICY_ENV: "",
            },
        });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableAuthentication(app);
        registerApiRoutes(app);
        await app.ready();
        const owner = await db.account.create({ data: { publicKey: "combo-api-owner" } });
        ownerId = owner.id;
        authorization = `Bearer ${await auth.createToken(ownerId)}`;
    }, 120_000);

    afterAll(async () => {
        await app.close();
        await harness?.close();
    });

    it.each([
        ["POST", "/v1/voice/token"],
        ["GET", "/v2/automations"],
        ["GET", "/v1/account/pets"],
        ["GET", "/v1/feed"],
        ["GET", "/v1/sessions/:sessionId/shares"],
        ["GET", "/v1/sessions/:sessionId/public-share"],
        ["GET", "/v1/public-share/:token"],
    ] as const)("does not expose %s %s even to an authenticated owner", async (method, route) => {
        const url = route.replace(/:[A-Za-z]+/g, "missing");
        const response = await app.inject({ method, url, headers: { authorization } });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(app.hasRoute({ method, url: route }), `${method} ${route} must not be mounted`).toBe(false);
    });

    it("keeps authenticated account, session, machine and entry APIs protected", async () => {
        for (const url of ["/v1/account/profile", "/v2/sessions", "/v1/machines", "/v1/shared-session-entries"]) {
            const response = await app.inject({ method: "GET", url });
            expect(response.statusCode, url).toBe(401);
        }
    });

    it("advertises the same minimal product surface through the default server features", async () => {
        const response = await app.inject({ method: "GET", url: "/v1/features" });
        expect(response.statusCode).toBe(200);
        expect(response.json().features).toMatchObject({
            voice: { enabled: false },
            automations: { enabled: false },
            pets: { companion: { enabled: false }, sync: { enabled: false } },
            social: { friends: { enabled: false } },
            connectedServices: { enabled: true, quotas: { enabled: false }, accountGroups: { enabled: false } },
            sharing: { session: { enabled: true }, sessionEntries: { enabled: true }, contentKeys: { enabled: true } },
        });
    });

    it("creates a managed entry through the production registration using a real account and database", async () => {
        const machine = await db.machine.create({ data: { id: "combo-api-host", accountId: ownerId, metadata: "opaque" } });
        const source = await db.session.create({ data: { accountId: ownerId, tag: "combo-api-source", metadata: "opaque", encryptionMode: "plain" } });
        const response = await app.inject({
            method: "POST", url: "/v1/shared-session-entries", headers: { authorization },
            payload: { title: "Shared workspace", sourceSessionId: source.id, machineId: machine.id },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().entry.sourceSessionId).toBe(source.id);
        const listing = await app.inject({ method: "GET", url: "/v1/shared-session-entries", headers: { authorization } });
        expect(listing.statusCode).toBe(200);
        expect(listing.json().entries).toHaveLength(1);
        expect(listing.body).not.toContain(response.json().inviteToken);
    });

    it("retains key authentication and Google signup, identity linking and callback handlers", async () => {
        const keyAuth = await app.inject({ method: "POST", url: "/v1/auth", payload: {} });
        expect(keyAuth.statusCode).toBe(400);
        const signup = await app.inject({ method: "GET", url: "/v1/auth/external/google/params?publicKey=test" });
        expect(signup.statusCode).toBe(404);
        expect(signup.json()).toEqual({ error: "unsupported-provider" });
        const link = await app.inject({ method: "GET", url: "/v1/connect/external/google/params", headers: { authorization } });
        expect(link.statusCode).toBe(404);
        expect(link.json()).toEqual({ error: "unsupported-provider" });
        const callback = await app.inject({ method: "GET", url: "/v1/oauth/google/callback?state=test&error=access_denied" });
        expect(callback.statusCode).toBe(302);
        expect(callback.headers.location).toContain("unsupported-provider");
    });
});
