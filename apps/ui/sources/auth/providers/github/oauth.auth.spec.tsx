import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import {
    flushOAuthEffects,
    localSearchParamsMock,
    loginSpy,
    modal,
    replaceSpy,
    resetOAuthHarness,
    clearPendingExternalAuthMock,
    runWithOAuthScreen,
    setPendingExternalAuthState,
    setStoredCredentialsState,
    setActiveServerSnapshot,
    upsertAndActivateServerSpy,
    setPendingExternalAuthMock,
    getPendingExternalAuthState,
    loginWithCredentialsSpy,
    setPendingExternalAuthServerMismatch,
} from './test/oauthReturnHarness';
import { renderScreen } from '@/dev/testkit';
import { t } from '@/text';


type FetchResult = {
    ok: boolean;
    status?: number;
    body: unknown;
};

const OAUTH_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

function stubFetch(
    handler: (url: string, init?: RequestInit) => Promise<FetchResult>,
): ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
        const result = await handler(String(input), init);
        return {
            ok: result.ok,
            status: result.status ?? (result.ok ? 200 : 500),
            json: async () => result.body,
        } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

async function handleHealthCheck(url: string): Promise<FetchResult | null> {
    if (!url.endsWith('/health')) return null;
    return { ok: true, body: { ok: true } };
}

afterEach(() => {
    resetOAuthHarness();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('/oauth/[provider] (auth flow)', () => {
    it('preserves a committed account key through an old consumed callback before a fresh OAuth retry', async () => {
        const returnTo = '/invite/reopen?server=https%3A%2F%2Frelay.example';
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, returnTo });
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p1' });
        let committedPublicKey: string | null = null;
        const pendings: string[] = [];
        stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            const body = JSON.parse(String(init?.body));
            pendings.push(body.pending);
            if (!committedPublicKey) {
                committedPublicKey = body.publicKey;
                throw new TypeError('Response lost after commit');
            }
            if (body.pending === 'p1') return { ok: false, status: 400, body: { error: 'invalid-pending' } };
            expect(body.publicKey).toBe(committedPublicKey);
            return { ok: true, body: { token: 'same-account-token' } };
        });

        await runWithOAuthScreen(async () => {
            expect(getPendingExternalAuthState()).toEqual(expect.objectContaining({ secret: OAUTH_SECRET, finalizeAttempted: true }));
        });
        // Refresh/back reopens the consumed callback. Its rejection must not destroy the account key.
        await runWithOAuthScreen(async () => {
            expect(getPendingExternalAuthState()).toEqual(expect.objectContaining({ secret: OAUTH_SECRET, finalizeAttempted: true, returnTo }));
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
        });
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p2', accountMode: 'e2ee' });
        await runWithOAuthScreen(async () => {
            expect(loginSpy).toHaveBeenCalledWith('same-account-token', OAUTH_SECRET);
            expect(getPendingExternalAuthState()).toBeNull();
            expect(replaceSpy).toHaveBeenLastCalledWith(returnTo);
        });
        expect(pendings).toEqual(['p1', 'p1', 'p2']);
    });

    it.each(['server-id', 'server-url'] as const)('retains server A recovery state without a request when its callback is opened on server B (%s)', async (mismatch) => {
        const pending = {
            provider: 'github', secret: OAUTH_SECRET, finalizeAttempted: true,
            serverId: 'server-a', serverUrl: 'https://a.example', returnTo: '/invite/a?server=https%3A%2F%2Fa.example',
        };
        setPendingExternalAuthState(pending);
        setActiveServerSnapshot({ serverId: 'server-b', serverUrl: 'https://b.example' });
        setPendingExternalAuthServerMismatch(mismatch === 'server-id');
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p1' });
        const fetchMock = stubFetch(async () => { throw new Error('Wrong-server request'); });
        await runWithOAuthScreen(async () => {
            expect(fetchMock).not.toHaveBeenCalled();
            expect(getPendingExternalAuthState()).toEqual(pending);
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(modal.alert).toHaveBeenCalledWith(t('common.error'), t('errors.oauthStateMismatch'));
        });
    });

    it.each(['username-cancel', 'unsupported-provisioning'] as const)('keeps a possibly committed key when leaving an incomplete callback (%s)', async (outcome) => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, proof: 'proof', finalizeAttempted: true, returnTo: '/invite/cancel' });
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', pending: 'p2',
            ...(outcome === 'username-cancel'
                ? { status: 'username_required' }
                : { provisioning: 'required', storagePolicy: 'optional', provisioningModes: '' }),
        });
        const fetchMock = stubFetch(async () => { throw new Error('Unexpected request'); });
        const { default: Screen } = await import('@/app/(app)/oauth/[provider]');
        const screen = await renderScreen(React.createElement(Screen));
        await flushOAuthEffects();
        if (outcome === 'username-cancel') await screen.pressByTestIdAsync('oauth-username-cancel');
        await flushOAuthEffects();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(getPendingExternalAuthState()).toEqual(expect.objectContaining({ secret: OAUTH_SECRET, finalizeAttempted: true }));
        expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
    });

    it.each([{ accountMode: 'plain' }, { mode: 'keyless' }])('does not exchange a protected account key for plaintext credentials (%j)', async (modeParams) => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, proof: 'proof', finalizeAttempted: true, returnTo: '/invite/keyed' });
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p2', ...modeParams });
        const fetchMock = stubFetch(async (url) => (await handleHealthCheck(url)) ?? { ok: true, body: { token: 'different-plain-account' } });
        await runWithOAuthScreen(async () => {
            expect(fetchMock).not.toHaveBeenCalled();
            expect(loginWithCredentialsSpy).not.toHaveBeenCalled();
            expect(getPendingExternalAuthState()).toEqual(expect.objectContaining({ secret: OAUTH_SECRET, finalizeAttempted: true }));
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(modal.alert).toHaveBeenCalled();
        });
    });

    it.each(['response-lost', 'server-error', 'incomplete-success'] as const)('recovers the committed account with the preserved key after %s and a fresh OAuth round trip', async (failure) => {
        const returnTo = '/invite/retry?server=https%3A%2F%2Frelay.example';
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, returnTo });
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p1' });
        let committedPublicKey: string | null = null;
        const finalizePendings: string[] = [];
        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            expect(url).toContain('/finalize');
            const body = JSON.parse(String(init?.body));
            finalizePendings.push(body.pending);
            if (!committedPublicKey) {
                committedPublicKey = body.publicKey;
                if (failure === 'server-error') return { ok: false, status: 500, body: { error: 'internal-error' } };
                if (failure === 'incomplete-success') return { ok: true, body: {} };
                throw new TypeError('Response lost after account commit');
            }
            expect(body.publicKey).toBe(committedPublicKey);
            return { ok: true, body: { token: 'committed-account-token' } };
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(modal.alert).toHaveBeenCalledWith(t('common.error'), t('errors.tokenExchangeFailed'));
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(setPendingExternalAuthMock).toHaveBeenCalledWith(expect.objectContaining({ secret: OAUTH_SECRET, finalizeAttempted: true }));
            expect(replaceSpy).toHaveBeenCalledWith(`/?returnTo=${encodeURIComponent(returnTo)}`);
            expect(loginSpy).not.toHaveBeenCalled();
        });
        // A user starts a fresh provider authorization; the old pending request is never replayed.
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p2', accountMode: 'e2ee' });
        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(loginSpy).toHaveBeenCalledWith('committed-account-token', OAUTH_SECRET);
            expect(clearPendingExternalAuthMock).toHaveBeenCalledTimes(1);
            expect(replaceSpy).toHaveBeenLastCalledWith(returnTo);
        });
        expect(finalizePendings).toEqual(['p1', 'p2']);
        expect(fetchMock).toHaveBeenCalled();
    });

    it('retains the keyed recovery state when credentials cannot be persisted after finalize succeeds', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, returnTo: '/invite/storage' });
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p1' });
        loginSpy.mockRejectedValueOnce(new Error('Credential storage failed'));
        stubFetch(async (url) => (await handleHealthCheck(url)) ?? { ok: true, body: { token: 'committed-token' } });
        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(setPendingExternalAuthMock).toHaveBeenCalledWith(expect.objectContaining({ secret: OAUTH_SECRET, finalizeAttempted: true }));
            expect(replaceSpy).toHaveBeenCalledWith('/?returnTo=%2Finvite%2Fstorage');
        });
    });

    it('keeps invalid username input editable and completes after correction without restarting OAuth', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, returnTo: '/invite/username' });
        localSearchParamsMock.mockReturnValue({
            provider: 'github', flow: 'auth', status: 'username_required', reason: 'invalid_login', login: 'user@example.test', pending: 'p1',
        });
        const submitted: string[] = [];
        stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            const body = JSON.parse(String(init?.body ?? '{}')) as { username: string };
            submitted.push(body.username);
            return body.username === 'valid_user'
                ? { ok: true, body: { success: true, token: 'tok_1' } }
                : { ok: false, status: 400, body: { error: 'invalid-username' } };
        });
        const { default: Screen } = await import('@/app/(app)/oauth/[provider]');
        const screen = await renderScreen(React.createElement(Screen));
        await flushOAuthEffects();
        act(() => { screen.changeTextByTestId('oauth-username-input', 'invalid!'); });
        await screen.pressByTestIdAsync('oauth-username-save');
        await flushOAuthEffects();
        expect.soft(clearPendingExternalAuthMock).not.toHaveBeenCalled();
        expect.soft(replaceSpy).not.toHaveBeenCalled();
        expect(screen.findByTestId('oauth-username-input')?.props.value).toBe('invalid!');
        expect(screen.getTextContent()).toContain(t('friends.username.invalid'));
        act(() => { screen.changeTextByTestId('oauth-username-input', 'valid_user'); });
        await screen.pressByTestIdAsync('oauth-username-save');
        await flushOAuthEffects();
        expect(submitted).toEqual(['invalid!', 'valid_user']);
        expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
        expect(replaceSpy).toHaveBeenCalledWith('/invite/username');
    });

    it('uses the pending external auth serverUrl for finalize requests when present', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, serverUrl: 'http://api.example.test' });
        setActiveServerSnapshot({ serverUrl: '' });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url === 'http://api.example.test/v1/auth/external/github/finalize') {
                expect(init?.method).toBe('POST');
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(fetchMock).toHaveBeenCalled();
            expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
            expect(replaceSpy).toHaveBeenCalledWith('/');
        });
    });

    it('fails closed when pending external auth serverUrl does not match the active server snapshot', async () => {
        setPendingExternalAuthState({
            provider: 'github',
            secret: OAUTH_SECRET,
            serverUrl: 'http://api.example.test',
        });
        setActiveServerSnapshot({ serverUrl: 'http://other.example.test' });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        clearPendingExternalAuthMock.mockClear();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        const fetchMock = stubFetch(async (url) => {
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(modal.alert).toHaveBeenCalledWith(t('common.error'), t('errors.oauthStateMismatch'));
            expect(loginSpy).not.toHaveBeenCalled();
            expect(replaceSpy).toHaveBeenCalledWith('/');
        });
    });

    it('does not fail closed when pending external auth serverUrl is loopback-equivalent to the active server snapshot', async () => {
        setPendingExternalAuthState({
            provider: 'github',
            secret: OAUTH_SECRET,
            serverUrl: 'http://localhost:3005',
        });
        setActiveServerSnapshot({ serverUrl: 'http://127.0.0.1:3005/' });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        upsertAndActivateServerSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url === 'http://localhost:3005/v1/auth/external/github/finalize') {
                expect(init?.method).toBe('POST');
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(fetchMock).toHaveBeenCalled();
            expect(upsertAndActivateServerSpy).not.toHaveBeenCalled();
            expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
            expect(replaceSpy).toHaveBeenCalledWith('/');
        });
    });

    it('falls back to resolving the provider id from window.location.pathname', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        localSearchParamsMock.mockReturnValue({
            flow: 'auth',
            pending: 'p1',
        });

        const originalWindow = (globalThis as any).window;
        (globalThis as any).window = {
            location: {
                pathname: '/oauth/github',
            },
        };

        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                expect(init?.method).toBe('POST');
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        try {
            await runWithOAuthScreen(async () => {
                await flushOAuthEffects();
                expect(fetchMock).toHaveBeenCalledWith(
                    expect.stringContaining('/v1/auth/external/github/finalize'),
                    expect.anything(),
                );
                expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
                expect(replaceSpy).toHaveBeenCalledWith('/');
            });
        } finally {
            (globalThis as any).window = originalWindow;
        }
    });

    it('falls back to resolving query params from window.location.search on cold start', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        // Some web cold-starts/hydration paths can temporarily omit search params from useLocalSearchParams.
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
        });

        const originalWindow = (globalThis as any).window;
        (globalThis as any).window = {
            location: {
                pathname: '/oauth/github',
                search: '?flow=auth&pending=p1',
            },
        };

        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                expect(init?.method).toBe('POST');
                const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
                expect(body.pending).toBe('p1');
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        try {
            await runWithOAuthScreen(async () => {
                await flushOAuthEffects();
                expect(fetchMock).toHaveBeenCalledWith(
                    expect.stringContaining('/v1/auth/external/github/finalize'),
                    expect.anything(),
                );
                expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
                expect(replaceSpy).toHaveBeenCalledWith('/');
            });
        } finally {
            (globalThis as any).window = originalWindow;
        }
    });

    it('finalizes external auth and logs in when flow=auth', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                expect(init?.method).toBe('POST');
                const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
                expect(body.pending).toBe('p1');
                expect(typeof body.publicKey).toBe('string');
                expect(typeof body.challenge).toBe('string');
                expect(typeof body.signature).toBe('string');
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/v1/auth/external/github/finalize'),
                expect.anything(),
            );
            expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
            expect(replaceSpy).toHaveBeenCalledWith('/');
        });
    });

    it('does not show an initialization error when pending state is missing but credentials already exist', async () => {
        setPendingExternalAuthState(null);
        setStoredCredentialsState({ token: 'tok_existing', secret: 'sec_existing' });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        stubFetch(async (url) => {
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(modal.alert).not.toHaveBeenCalled();
            expect(loginSpy).not.toHaveBeenCalled();
            expect(replaceSpy).toHaveBeenCalledWith('/');
        });
    });

    it('renders a username form and includes it in finalize when status=username_required', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            status: 'username_required',
            reason: 'login_taken',
            login: 'octocat',
            pending: 'p1',
        });

        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
                expect(body.username).toBe('octocat_2');
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const { default: Screen } = await import('@/app/(app)/oauth/[provider]');
        const screen = await renderScreen(React.createElement(Screen));
        await flushOAuthEffects();
        expect(fetchMock).not.toHaveBeenCalledWith(
            expect.stringContaining('/v1/auth/external/github/finalize'),
            expect.anything(),
        );

        const input = screen.findByTestId('oauth-username-input');
        expect(input).toBeTruthy();
        act(() => {
            input?.props.onChangeText('octocat_2');
        });

        await screen.pressByTestIdAsync('oauth-username-save');
        await flushOAuthEffects();

        expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
        expect(replaceSpy).toHaveBeenCalledWith('/');
    });

    it('redirects to the pending external auth returnTo after login when provided', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET, returnTo: '/settings/account' });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        stubFetch(async (url) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
            expect(replaceSpy).toHaveBeenCalledWith('/settings/account');
        });
    });

    it('includes reset=true in finalize when pending external auth intent=reset', async () => {
        setActiveServerSnapshot({ serverUrl: '' });
        setPendingExternalAuthState({
            provider: 'github',
            secret: OAUTH_SECRET,
            intent: 'reset',
            serverUrl: 'http://api.example.test',
        });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        upsertAndActivateServerSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        const fetchMock = stubFetch(async (url, init) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
                expect(body.reset).toBe(true);
                return { ok: true, body: { success: true, token: 'tok_1' } };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/v1/auth/external/github/finalize'),
                expect.anything(),
            );
            expect(upsertAndActivateServerSpy).toHaveBeenCalledWith(
                expect.objectContaining({ serverUrl: 'http://api.example.test' }),
            );
            expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
        });
    });

    it('logs in and redirects even if the effect is cancelled by a params re-render (success token)', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();
        clearPendingExternalAuthMock.mockClear();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        let resolveFinalize: ((result: FetchResult) => void) | null = null;
        const finalizeDeferred = new Promise<FetchResult>((resolve) => {
            resolveFinalize = resolve;
        });

        const fetchMock = stubFetch(async (url) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                return await finalizeDeferred;
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/oauth/[provider]');

        let tree: ReturnType<typeof renderer.create> | undefined;
        tree = (await renderScreen(React.createElement(Screen))).tree;
        if (!tree) throw new Error('Expected OAuth screen to render');
        const ensuredTree = tree;
        try {
            await flushOAuthEffects();
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/auth/external/github/finalize'), expect.anything());

            // Simulate expo-router updating params after hydration; this cancels the first effect run.
            localSearchParamsMock.mockReturnValue({
                provider: 'github',
                flow: 'auth',
                pending: 'p1',
                hydrated: '1',
            });
            act(() => {
                ensuredTree.update(React.createElement(Screen));
            });

            await act(async () => {
                resolveFinalize?.({ ok: true, status: 200, body: { token: 'tok_1' } });
            });
            await flushOAuthEffects();

            expect(clearPendingExternalAuthMock).toHaveBeenCalled();
            expect(loginSpy).toHaveBeenCalledWith('tok_1', OAUTH_SECRET);
            expect(replaceSpy).toHaveBeenCalledWith('/');
        } finally {
            act(() => {
                ensuredTree.unmount();
            });
        }
    });

    it('redirects to restore even if the effect is cancelled by a params re-render (provider already linked)', async () => {
        setPendingExternalAuthState({ provider: 'github', secret: OAUTH_SECRET });
        replaceSpy.mockReset();
        loginSpy.mockClear();
        modal.alert.mockClear();
        modal.prompt.mockReset();
        clearPendingExternalAuthMock.mockClear();

        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });

        let resolveFinalize: ((result: FetchResult) => void) | null = null;
        const finalizeDeferred = new Promise<FetchResult>((resolve) => {
            resolveFinalize = resolve;
        });

        const fetchMock = stubFetch(async (url) => {
            const health = await handleHealthCheck(url);
            if (health) return health;
            if (url.endsWith('/v1/auth/external/github/finalize')) {
                return await finalizeDeferred;
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        vi.resetModules();
        const { default: Screen } = await import('@/app/(app)/oauth/[provider]');

        let tree: ReturnType<typeof renderer.create> | undefined;
        tree = (await renderScreen(React.createElement(Screen))).tree;
        if (!tree) throw new Error('Expected OAuth screen to render');
        const ensuredTree = tree;
        try {
            await flushOAuthEffects();
            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/auth/external/github/finalize'), expect.anything());

            // Simulate expo-router updating params after hydration; this cancels the first effect run
            // (cleanup sets cancelled=true) and previously could suppress navigation.
            localSearchParamsMock.mockReturnValue({
                provider: 'github',
                flow: 'auth',
                pending: 'p1',
                hydrated: '1',
            });
            act(() => {
                ensuredTree.update(React.createElement(Screen));
            });

            await act(async () => {
                resolveFinalize?.({ ok: false, status: 409, body: { error: 'provider-already-linked', provider: 'github' } });
            });
            await flushOAuthEffects();

            expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
            expect(getPendingExternalAuthState()).toEqual(expect.objectContaining({ secret: OAUTH_SECRET, finalizeAttempted: true }));
            expect(replaceSpy).toHaveBeenCalledWith('/restore?provider=github&reason=provider_already_linked');
        } finally {
            act(() => {
                ensuredTree.unmount();
            });
        }
    });
});
