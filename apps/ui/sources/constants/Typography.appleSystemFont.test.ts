import { beforeEach, describe, expect, it, vi } from 'vitest';

type PlatformMock = {
    OS: string;
};

async function loadTypography(params: Readonly<{ platform: PlatformMock; userAgent?: string }>) {
    vi.doMock('react-native', async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: params.platform,
        });
    });

    if (params.userAgent) {
        vi.stubGlobal('navigator', { userAgent: params.userAgent } as any);
    }

    return await import('./Typography');
}

describe('Typography.default system font preference', () => {
    beforeEach(() => {
        vi.resetModules();
        // Ensure previous tests don't leak navigator overrides.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as any).navigator;
    });

    it('uses system font on native iOS by omitting fontFamily', async () => {
        const mod = await loadTypography({ platform: { OS: 'ios' } });
        expect(mod.Typography.default()).not.toHaveProperty('fontFamily');
        expect(mod.Typography.default('semiBold')).toEqual({ fontWeight: mod.FontWeights.semiBold });
        expect(mod.Typography.default('italic')).toEqual({ fontStyle: 'italic' });
    });

    it('keeps Inter on native Android', async () => {
        const mod = await loadTypography({ platform: { OS: 'android' } });
        expect(mod.Typography.default()).toEqual({ fontFamily: 'Inter-Regular' });
        expect(mod.Typography.default('semiBold')).toEqual({ fontFamily: 'Inter-SemiBold' });
        expect(mod.Typography.default('italic')).toEqual({ fontFamily: 'Inter-Italic' });
    });

    it.each([
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0',
        undefined,
    ])('uses the system stack on web without depending on navigator (%s)', async (userAgent) => {
        const mod = await loadTypography({
            platform: { OS: 'web' },
            userAgent,
        });
        const fontFamily = mod.getDefaultFont();
        expect(fontFamily).toContain('system-ui');
        expect(fontFamily).toContain('Segoe UI');
        expect(fontFamily).toContain('PingFang SC');
        expect(mod.Typography.default()).toEqual({ fontFamily });
        expect(mod.Typography.default('semiBold')).toEqual({
            fontFamily,
            fontWeight: mod.FontWeights.semiBold,
        });
        expect(mod.Typography.default('italic')).toEqual({ fontFamily, fontStyle: 'italic' });
        expect(mod.Typography.mono()).toEqual({ fontFamily: 'IBMPlexMono-Regular' });
    });
});
