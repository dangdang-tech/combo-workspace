import { afterEach, describe, expect, it, vi } from 'vitest';

function randomScope(): string {
    return `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stubWebLocation(href: string) {
    vi.stubGlobal('window', {
        location: { href },
        history: { replaceState: vi.fn() },
    });
    vi.stubGlobal('document', {});
}

function stubSessionStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => void store.clear(),
    });
}

async function importFreshBootstrap() {
    vi.resetModules();
    return await import('./bootstrapActiveServerFromWebLocation');
}

async function importFreshServerProfiles() {
    return await import('../serverProfiles');
}

describe('bootstrapActiveServerFromWebLocation', () => {
    const previousEnv = process.env.EXPO_PUBLIC_HAPPY_SERVER_URL;
    const previousContext = process.env.EXPO_PUBLIC_HAPPY_SERVER_CONTEXT;
    const previousPreconfigured = process.env.EXPO_PUBLIC_HAPPY_PRECONFIGURED_SERVERS;
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = previousEnv;
        if (previousContext === undefined) delete process.env.EXPO_PUBLIC_HAPPY_SERVER_CONTEXT;
        else process.env.EXPO_PUBLIC_HAPPY_SERVER_CONTEXT = previousContext;
        if (previousPreconfigured === undefined) delete process.env.EXPO_PUBLIC_HAPPY_PRECONFIGURED_SERVERS;
        else process.env.EXPO_PUBLIC_HAPPY_PRECONFIGURED_SERVERS = previousPreconfigured;
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
    });

    it('activates the server from the web query string immediately', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'http://localhost:57012';

        stubWebLocation('http://happier-github-auth-e2ee.localhost:19081/?server=http%3A%2F%2Flocalhost%3A57010');

        const { bootstrapActiveServerFromWebLocation } = await importFreshBootstrap();
        const result = bootstrapActiveServerFromWebLocation({ scope: 'device' });

        const { getActiveServerUrl } = await importFreshServerProfiles();
        expect(getActiveServerUrl()).toBe('http://localhost:57010');
        expect(result?.serverUrl).toBe('http://localhost:57010');
    });

    it('reuses the same equivalent loopback server profile without rewriting its stored url', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'http://qa-stack.localhost:57010';

        stubWebLocation('http://happier-github-auth-e2ee.localhost:19081/?server=http%3A%2F%2F127.0.0.1%3A57010');

        const { bootstrapActiveServerFromWebLocation } = await importFreshBootstrap();
        const result = bootstrapActiveServerFromWebLocation({ scope: 'device' });

        const { getActiveServerId, getActiveServerUrl } = await importFreshServerProfiles();
        expect(getActiveServerId()).toBe('qa-stack.localhost-57010');
        expect(getActiveServerUrl()).toBe('http://qa-stack.localhost:57010');
        expect(result?.serverUrl).toBe('http://127.0.0.1:57010');
    });

    it('keeps the relay intent visible until connection and auth commit', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'http://localhost:57010';

        stubWebLocation('http://happier-github-auth-e2ee.localhost:19081/session/session-1?server=http%3A%2F%2F127.0.0.1%3A57010&serverId=127.0.0.1-57010&tab=files');

        const { bootstrapActiveServerFromWebLocation } = await importFreshBootstrap();
        const result = bootstrapActiveServerFromWebLocation({ scope: 'device' });

        expect(result?.serverUrl).toBe('http://127.0.0.1:57010');
        expect(result?.cleanedRelativeUrl).toBe('/session/session-1?tab=files');
        expect(window.history.replaceState).not.toHaveBeenCalled();
    });

    it('cleans the relay intent only after the active connection and auth refresh commit', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'https://relay.example.test';
        stubWebLocation('https://app.example.test/session/session-1?server=https%3A%2F%2Frelay.example.test&serverId=stale');

        const { commitWebServerUrlOverride, readWebServerUrlOverrideFromLocation } = await importFreshBootstrap();
        const override = readWebServerUrlOverrideFromLocation();
        expect(override).not.toBeNull();
        const refreshAuth = vi.fn()
            .mockRejectedValueOnce(new Error('auth refresh failed'))
            .mockResolvedValueOnce(undefined);

        await expect(commitWebServerUrlOverride({
            override: override!,
            refreshAuth,
        })).rejects.toThrow('auth refresh failed');
        expect(window.history.replaceState).not.toHaveBeenCalled();

        await expect(commitWebServerUrlOverride({
            override: override!,
            refreshAuth,
        })).resolves.toBeUndefined();
        expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/session/session-1');
    });

    it.each([
        '/session/child?serverId=relay',
        '/invite/another?server=https%3A%2F%2Fother.example.test',
    ])('does not replay the initial invite URL after navigation to %s during auth refresh', async (destination) => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'https://relay.example.test';
        stubWebLocation('https://app.example.test/invite/original?server=https%3A%2F%2Frelay.example.test');
        const { commitWebServerUrlOverride, readWebServerUrlOverrideFromLocation } = await importFreshBootstrap();
        let finish!: () => void;
        let started!: () => void;
        const startedPromise = new Promise<void>((resolve) => { started = resolve; });
        const refreshAuth = () => { started(); return new Promise<void>((resolve) => { finish = resolve; }); };
        const pending = commitWebServerUrlOverride({ override: readWebServerUrlOverrideFromLocation()!, refreshAuth });
        await startedPromise;
        window.location.href = `https://app.example.test${destination}`;
        finish();
        await pending;
        expect(window.history.replaceState).not.toHaveBeenCalled();
        expect(window.location.href).toBe(`https://app.example.test${destination}`);
    });

    it('preserves router history state when cleaning an unchanged server intent', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'https://relay.example.test';
        stubWebLocation('https://app.example.test/invite/original?server=https%3A%2F%2Frelay.example.test');
        const routerState = { key: 'invite-route', index: 2 };
        Object.assign(window.history, { state: routerState });
        const { commitWebServerUrlOverride, readWebServerUrlOverrideFromLocation } = await importFreshBootstrap();
        await commitWebServerUrlOverride({ override: readWebServerUrlOverrideFromLocation()!, refreshAuth: async () => {} });
        expect(window.history.replaceState).toHaveBeenCalledWith(routerState, '', '/invite/original');
    });

    it('promotes an equivalent tab override to the device active server from the web query string', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'https://device.example.test';
        stubSessionStorage();
        stubWebLocation('https://app.example.test/?server=https%3A%2F%2Ftab.example.test');

        vi.resetModules();
        const profiles = await importFreshServerProfiles();
        const deviceProfile = profiles.upsertServerProfile({
            serverUrl: 'https://device.example.test',
            name: 'Device',
        });
        const tabProfile = profiles.upsertServerProfile({
            serverUrl: 'https://tab.example.test',
            name: 'Tab',
        });
        profiles.setActiveServerId(deviceProfile.id, { scope: 'device' });
        profiles.setActiveServerId(tabProfile.id, { scope: 'tab' });

        const { bootstrapActiveServerFromWebLocation } = await import('./bootstrapActiveServerFromWebLocation');
        const result = bootstrapActiveServerFromWebLocation({ scope: 'device' });

        expect(result?.serverUrl).toBe('https://tab.example.test');
        expect(profiles.getTabActiveServerId()).toBeNull();
        expect(profiles.getDeviceDefaultServerId()).toBe(tabProfile.id);
        expect(profiles.getActiveServerUrl()).toBe('https://tab.example.test');
    });

    it('does not consume terminal connect query params as a global server override', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_SERVER_URL = 'https://api.happier.dev';

        stubWebLocation('https://app.example.test/terminal/connect?key=abc123&server=https%3A%2F%2Fwrong.example.test');

        const { bootstrapActiveServerFromWebLocation, readWebServerUrlOverrideFromLocation } = await importFreshBootstrap();
        const override = readWebServerUrlOverrideFromLocation();
        const result = bootstrapActiveServerFromWebLocation({ scope: 'device' });

        const { getActiveServerUrl } = await importFreshServerProfiles();
        expect(override).toBeNull();
        expect(result).toBeNull();
        expect(getActiveServerUrl()).toBe('https://api.happier.dev');
    });
});
