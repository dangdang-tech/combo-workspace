import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import tweetnacl from "tweetnacl";
import * as privacyKit from "privacy-kit";

import { db } from "@/storage/db";
import { connectRoutes } from "./connectRoutes";
import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { startOidcStubServer, type OidcStubServer } from "../../testkit/oidcStub";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

const { trackApp, closeTrackedApps } = createAppCloseTracker();

// Exercise the production discovery, signed ID token exchange, callback, and keyed finalize routes.
// Only the external identity-provider HTTP boundary is substituted with a local signed OIDC server.
describe("Google OIDC keyed signup (integration)", () => {
    let harness: LightSqliteHarness;
    let oidcStub: OidcStubServer | undefined;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-google-oidc-", initAuth: true, initEncrypt: true,
        });
    }, 120_000);

    afterEach(async () => {
        await closeTrackedApps();
        await oidcStub?.close();
        oidcStub = undefined;
        harness.resetEnv();
        await db.repeatKey.deleteMany();
        await db.accountIdentity.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => { await harness.close(); });

    it.each([true, false])("requires a verified Google email for E2EE account signup (verified=%s)", async (emailVerified) => {
        oidcStub = await startOidcStubServer({
            idTokenClaims: {
                sub: "100000000000000000001",
                preferred_username: undefined,
                email: "alice@gmail.com",
                email_verified: emailVerified,
                name: "Alice Example",
                picture: "https://example.test/alice.png",
                groups: undefined,
            },
        });
        harness.resetEnv({
            AUTH_SIGNUP_PROVIDERS: "google",
            AUTH_REQUIRED_LOGIN_PROVIDERS: "google",
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{
                id: "google", type: "oidc", displayName: "Google", issuer: oidcStub.issuer,
                clientId: "oidc_client", clientSecret: "oidc_secret",
                redirectUrl: "https://api.example.test/v1/oauth/google/callback",
                scopes: "openid profile email", allow: { requireVerifiedEmail: true },
            }]),
            HAPPIER_WEBAPP_URL: "https://app.example.test",
        });
        const app = trackApp(Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>());
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        connectRoutes(app as any);
        await app.ready();

        const signingKeys = tweetnacl.sign.keyPair();
        const publicKey = privacyKit.encodeBase64(new Uint8Array(signingKeys.publicKey));
        const params = await app.inject({
            method: "GET", url: `/v1/auth/external/google/params?publicKey=${encodeURIComponent(publicKey)}`,
        });
        expect(params.statusCode).toBe(200);
        const authorizeUrl = new URL(params.json().url);
        expect(authorizeUrl.searchParams.get("scope")).toBe("openid profile email");
        expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorizeUrl.searchParams.get("nonce")).toBeTruthy();
        const authorize = await fetch(authorizeUrl, { redirect: "manual" });
        expect(authorize.status).toBe(302);
        const callbackUrl = new URL(authorize.headers.get("location")!);
        const callback = await app.inject({ method: "GET", url: `${callbackUrl.pathname}${callbackUrl.search}` });
        expect(callback.statusCode).toBe(302);
        const returnUrl = new URL(callback.headers.location as string);
        const pending = returnUrl.searchParams.get("pending");
        expect(pending).toBeTruthy();

        const challenge = randomBytes(32);
        const contentKeys = tweetnacl.box.keyPair();
        const contentBinding = Buffer.concat([Buffer.from("Happy content key v1\u0000"), Buffer.from(contentKeys.publicKey)]);
        const contentSignature = tweetnacl.sign.detached(contentBinding, signingKeys.secretKey);
        const proof = {
            pending, publicKey,
            challenge: privacyKit.encodeBase64(new Uint8Array(challenge)),
            signature: privacyKit.encodeBase64(new Uint8Array(tweetnacl.sign.detached(challenge, signingKeys.secretKey))),
            contentPublicKey: privacyKit.encodeBase64(new Uint8Array(contentKeys.publicKey)),
            contentPublicKeySig: privacyKit.encodeBase64(new Uint8Array(contentSignature)),
        };
        // Google email fallback is a provider login, not a valid Happier username.
        const withoutUsername = await app.inject({ method: "POST", url: "/v1/auth/external/google/finalize", payload: proof });
        expect(withoutUsername.statusCode).toBe(400);
        expect(withoutUsername.json()).toEqual({ error: "username-required" });
        const finalized = await app.inject({
            method: "POST", url: "/v1/auth/external/google/finalize", payload: { ...proof, username: "alice" },
        });
        if (!emailVerified) {
            expect(finalized.statusCode).toBe(403);
            expect(finalized.json()).toEqual({ error: "not-eligible" });
            expect(await db.accountIdentity.count()).toBe(0);
            expect(await db.account.count()).toBe(0);
            return;
        }
        expect(finalized.statusCode).toBe(200);
        expect(finalized.json()).toMatchObject({ success: true, token: expect.any(String) });
        const account = await db.account.findUniqueOrThrow({ where: { publicKey: privacyKit.encodeHex(new Uint8Array(signingKeys.publicKey)) } });
        expect(account.encryptionMode).toBe("e2ee");
        expect(account.username).toBe("alice");
        expect(Buffer.from(account.contentPublicKey!)).toEqual(Buffer.from(contentKeys.publicKey));
        expect(Buffer.from(account.contentPublicKeySig!)).toEqual(Buffer.from(contentSignature));
        expect(await db.accountIdentity.findMany({
            select: { accountId: true, provider: true, providerUserId: true, providerLogin: true },
        })).toEqual([{
            accountId: account.id, provider: "google", providerUserId: "100000000000000000001", providerLogin: "alice@gmail.com",
        }]);
    });
});
