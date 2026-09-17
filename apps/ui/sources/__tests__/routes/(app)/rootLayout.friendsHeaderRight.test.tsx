import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stack } from 'expo-router';


import { createOkFetchResponse, createRootLayoutFeaturesResponse, flushHookEffects, renderScreen } from '@/dev/testkit';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});

vi.mock('@/components/navigation/mobile/chrome/MobileBottomChromeHost', () => ({
    MobileBottomChromeHost: () => React.createElement('MobileBottomChromeHost'),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false }),
}));

vi.mock('@/auth/routing/authRouting', () => ({
    isPublicRouteForUnauthenticated: () => true,
}));

function stubRootLayoutFeaturesFetch() {
    const payload = createRootLayoutFeaturesResponse();
    const fetchMock: typeof fetch = (() => createOkFetchResponse(payload)) as unknown as typeof fetch;
    vi.stubGlobal('fetch', vi.fn(fetchMock));
}

async function renderRootLayout() {
    const { default: RootLayout } = await import('@/app/(app)/_layout');
    const screen = await renderScreen(<RootLayout />);
    await flushHookEffects({ cycles: 1, turns: 1 });
    return screen;
}

function getScreenNames(screen: Awaited<ReturnType<typeof renderScreen>>): string[] {
    return (screen.findAllByType(Stack.Screen) ?? [])
        .map((node) => node.props?.name)
        .filter((name): name is string => typeof name === 'string');
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('RootLayout', () => {
    it('registers only the core sharing workspace screens', async () => {
        vi.resetModules();
        stubRootLayoutFeaturesFetch();
        const tree = await renderRootLayout();
        try {
            const names = getScreenNames(tree);
            expect(names).toContain('session/[id]/message/[messageId]');
            expect(names).toContain('new/index');
            expect(names).toContain('settings');
            expect(names).not.toContain('friends/manage');
            expect(names).not.toContain('inbox/index');
            expect(names).not.toContain('session/[id]/runs/new');
            expect(names).not.toContain('session/[id]/git');
            expect(names).not.toContain('direct/browse');
            expect(names).not.toContain('desktop/pet-overlay');
            expect(tree.findAllByType('MobileBottomChromeHost' as never)).toHaveLength(1);
        } finally {
            await tree.unmount();
        }
    });

    it('delegates settings child routes to the nested settings layout', async () => {
        vi.resetModules();
        stubRootLayoutFeaturesFetch();

        const tree = await renderRootLayout();
        try {
            const screenNames = getScreenNames(tree);

            expect(screenNames).toContain('settings');
            expect(screenNames).not.toContain('settings/machines/this-computer');
        } finally {
            await tree?.unmount();
        }
    });
});
