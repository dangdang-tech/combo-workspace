import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    flushOAuthEffects,
    localSearchParamsMock,
    loginSpy,
    modal,
    replaceSpy,
    resetOAuthHarness,
    runWithOAuthScreen,
    setPendingExternalAuthState,
} from '@/auth/providers/github/test/oauthReturnHarness';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@shopify/react-native-skia', () => ({}));

afterEach(() => {
    vi.unstubAllGlobals();
    resetOAuthHarness();
});

describe('oauth/[provider] return', () => {
    it.each(['provider-already-linked', 'restore-required'])('preserves the invitation when finalize returns %s', async (error) => {
        const returnTo = '/invite/abc?server=https%3A%2F%2Frelay.example';
        setPendingExternalAuthState({ provider: 'github', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', returnTo });
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p1' });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error }), {
            status: 409, headers: { 'Content-Type': 'application/json' },
        })));

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            const destination = String(replaceSpy.mock.calls.at(-1)?.[0]);
            const parsed = new URL(destination, 'https://app.example.test');
            expect(parsed.pathname).toBe('/restore');
            expect(parsed.searchParams.get('returnTo')).toBe(returnTo);
            expect(parsed.searchParams.get('provider')).toBe('github');
            expect(parsed.searchParams.get('reason')).toBe('provider_already_linked');
            expect(loginSpy).not.toHaveBeenCalled();
        });
    });

    it('preserves the invitation when the callback identifies an encrypted account', async () => {
        const returnTo = '/invite/existing';
        setPendingExternalAuthState({ provider: 'github', proof: 'proof', returnTo });
        localSearchParamsMock.mockReturnValue({ provider: 'github', flow: 'auth', pending: 'p1', accountMode: 'e2ee' });
        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(replaceSpy).toHaveBeenCalledWith(`/restore?provider=github&reason=provider_already_linked&returnTo=${encodeURIComponent(returnTo)}`);
            expect(loginSpy).not.toHaveBeenCalled();
        });
    });

    it('routes to /restore when provider identity is already linked to another account', async () => {
        replaceSpy.mockReset();
        loginSpy.mockReset();
        modal.alert.mockReset();
        localSearchParamsMock.mockReturnValue({
            provider: 'github',
            flow: 'auth',
            pending: 'p1',
        });
        const originalFetch = globalThis.fetch;
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ error: 'provider-already-linked' }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        await runWithOAuthScreen(async () => {
            await flushOAuthEffects();
            expect(modal.alert).toHaveBeenCalledTimes(0);
            expect(replaceSpy).toHaveBeenCalledWith('/restore?provider=github&reason=provider_already_linked');
            expect(loginSpy).not.toHaveBeenCalled();
        });
        vi.stubGlobal('fetch', originalFetch);
    });
});
