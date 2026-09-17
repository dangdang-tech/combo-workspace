import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeFetchSpy = vi.hoisted(() => vi.fn());

vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchSpy(...args),
}));

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { encodeBase64 } from '@/encryption/base64';
import { encodeUTF8 } from '@/encryption/text';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';

const initialStorageState = storage.getState();

function featureResponse(enabled: boolean): Response {
    return Response.json(createRootLayoutFeaturesResponse({ features: { social: { friends: { enabled } } } }));
}

function requestPath(input: unknown): string {
    return new URL(String(input)).pathname;
}

function buildTokenWithSub(sub: string): string {
    const payload = encodeBase64(encodeUTF8(JSON.stringify({ sub })), 'base64');
    return `hdr.${payload}.sig`;
}

describe('fetchAndApplyFeed retry semantics', () => {
    beforeEach(() => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_BUILD_FEATURES_ALLOW', 'social.friends');
        storage.setState(initialStorageState, true);
        storage.getState().applySettingsLocal({ experiments: true, featureToggles: { 'social.friends': true } });
        resetServerFeaturesClientForTests();
    });

    afterEach(() => {
        runtimeFetchSpy.mockReset();
        resetServerFeaturesClientForTests();
        storage.setState(initialStorageState, true);
        vi.unstubAllEnvs();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('throws and performs only a single HTTP attempt when retry mode is none', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);

        upsertAndActivateServer({ serverUrl: 'https://server.example.test', scope: 'tab' });
        runtimeFetchSpy.mockImplementation(async (input: unknown) => requestPath(input) === '/v1/features'
            ? featureResponse(true)
            : new Response('nope', { status: 500 }));

        const { fetchAndApplyFeed } = await import('./syncFeed');

        const credentials: AuthCredentials = {
            token: buildTokenWithSub('server-test'),
            secret: encodeBase64(new Uint8Array(32).fill(1), 'base64url'),
        };

        const promise = fetchAndApplyFeed({
            credentials,
            getFeedItems: () => [],
            getFeedHead: () => null,
            assumeUsers: async () => {},
            getUsers: () => ({}),
            applyFeedItems: vi.fn(),
            log: { log: vi.fn() },
        });

        const assertion = expect(promise).rejects.toThrow();
        await vi.runAllTimersAsync();
        await assertion;

        expect(runtimeFetchSpy.mock.calls.filter(([input]) => requestPath(input) === '/v1/feed')).toHaveLength(1);
    });

    it('does not request or apply feed when the existing social feature is disabled', async () => {
        upsertAndActivateServer({ serverUrl: 'https://server.example.test', scope: 'tab' });
        runtimeFetchSpy.mockImplementation(async (input: unknown) => requestPath(input) === '/v1/features'
            ? featureResponse(false)
            : Response.json({ items: [], hasMore: false }));
        const { fetchAndApplyFeed } = await import('./syncFeed');
        const applyFeedItems = vi.fn();
        await fetchAndApplyFeed({
            credentials: { token: buildTokenWithSub('server-test'), secret: encodeBase64(new Uint8Array(32).fill(1), 'base64url') },
            getFeedItems: () => [], getFeedHead: () => null, assumeUsers: async () => {}, getUsers: () => ({}),
            applyFeedItems, log: { log: vi.fn() },
        });
        expect(runtimeFetchSpy.mock.calls.map(([input]) => requestPath(input))).not.toContain('/v1/feed');
        expect(applyFeedItems).not.toHaveBeenCalled();
    });

    it('drops fetched feed items when the captured sync scope is stale before apply', async () => {
        upsertAndActivateServer({ serverUrl: 'https://server.example.test', scope: 'tab' });
        runtimeFetchSpy.mockImplementation(async () => new Response(JSON.stringify({
                items: [
                    {
                        id: 'feed-a',
                        body: { kind: 'text', text: 'hello' },
                        cursor: 'c_1',
                        createdAt: 1,
                        repeatKey: null,
                    },
                ],
                hasMore: false,
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const { fetchAndApplyFeed } = await import('./syncFeed');

        const credentials: AuthCredentials = {
            token: buildTokenWithSub('server-test'),
            secret: encodeBase64(new Uint8Array(32).fill(1), 'base64url'),
        };
        const applyFeedItems = vi.fn();

        await fetchAndApplyFeed({
            credentials,
            getFeedItems: () => [],
            getFeedHead: () => null,
            assumeUsers: async () => {},
            getUsers: () => ({}),
            applyFeedItems,
            shouldContinue: () => false,
            log: { log: vi.fn() },
        } as Parameters<typeof fetchAndApplyFeed>[0] & { shouldContinue: () => boolean });

        expect(applyFeedItems).not.toHaveBeenCalled();
    });
});
