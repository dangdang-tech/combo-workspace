import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { Context } from "@/context";
import { resolveAuthPolicyFromEnv } from "@/app/auth/authPolicy";
import { resolveAuthProviderInstancesFromEnv } from "./oidcProviderConfig";
import { createOidcIdentityProvider } from "./oidcIdentityProvider";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

describe("oidcIdentityProvider.connect (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-oidc-connect-",
            initEncrypt: true,
            initAuth: false,
            initFiles: false,
        });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountIdentity.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it("updates the stored identity when reconnecting the same provider user", async () => {
        const account = await db.account.create({
            data: { publicKey: `pk-${Date.now()}-oidc-reconnect` },
            select: { id: true },
        });

        const provider = createOidcIdentityProvider({
            id: "oidc-test",
            type: "oidc",
            displayName: "OIDC Test",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/oidc-test/callback",
            scopes: "openid profile",
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
            httpTimeoutSeconds: 5,
        } as any);

        await provider.connect({
            ctx: Context.create(account.id),
            profile: { sub: "sub-1", preferred_username: "alice" },
            accessToken: "access-token",
        });

        await provider.connect({
            ctx: Context.create(account.id),
            profile: { sub: "sub-1", preferred_username: "alice2" },
            accessToken: "access-token",
        });

        const identity = await db.accountIdentity.findFirst({
            where: { accountId: account.id, provider: "oidc-test" },
            select: { providerUserId: true, providerLogin: true },
        });
        expect(identity?.providerUserId).toBe("sub-1");
        expect(identity?.providerLogin).toBe("alice2");
    });

    it.each([false, undefined, "true"])("rejects unverified Google profiles (email_verified=%s) before linking", async (emailVerified) => {
        const account = await db.account.create({ data: { publicKey: "google-verification-test" } });
        const config = resolveAuthProviderInstancesFromEnv({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{
                id: "google", type: "oidc", displayName: "Google",
                issuer: "https://accounts.google.com", clientId: "test", clientSecret: "test",
                redirectUrl: "https://server.example.test/v1/oauth/google/callback",
                allow: { requireVerifiedEmail: true },
            }]),
        }).instances[0]!;
        const provider = createOidcIdentityProvider(config);
        const profile = { sub: "100000000000000000001", email: "alice@gmail.com", email_verified: emailVerified };

        await expect(provider.connect({ ctx: Context.create(account.id), profile, accessToken: "test" }))
            .rejects.toThrow("not-eligible");
        expect(await db.accountIdentity.count()).toBe(0);

        // An identity recorded before this policy was enabled must also be denied on login.
        await db.accountIdentity.create({ data: {
            accountId: account.id, provider: "google", providerUserId: profile.sub,
            providerLogin: profile.email, profile,
        } });
        await expect(provider.enforceLoginEligibility!({
            accountId: account.id, env: {}, policy: resolveAuthPolicyFromEnv({}),
        })).resolves.toEqual({ ok: false, statusCode: 403, error: "not-eligible" });
    });

    it("accepts verified Google email and keeps sub identity when the email changes", async () => {
        const account = await db.account.create({ data: { publicKey: "google-stable-sub-test" } });
        const config = resolveAuthProviderInstancesFromEnv({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{
                id: "google", type: "oidc", displayName: "Google",
                issuer: "https://accounts.google.com", clientId: "test", clientSecret: "test",
                redirectUrl: "https://server.example.test/v1/oauth/google/callback",
                allow: { requireVerifiedEmail: true },
            }]),
        }).instances[0]!;
        const provider = createOidcIdentityProvider(config);
        for (const email of ["Alice@Example.Test", "alice.new@example.test"]) {
            await provider.connect({
                ctx: Context.create(account.id), accessToken: "test",
                profile: { sub: "100000000000000000001", email, email_verified: true },
            });
        }
        expect(await db.accountIdentity.findMany({ select: { provider: true, providerUserId: true, providerLogin: true } }))
            .toEqual([{ provider: "google", providerUserId: "100000000000000000001", providerLogin: "alice.new@example.test" }]);
        await expect(provider.enforceLoginEligibility!({
            accountId: account.id, env: {}, policy: resolveAuthPolicyFromEnv({}),
        })).resolves.toEqual({ ok: true });
    });

});
