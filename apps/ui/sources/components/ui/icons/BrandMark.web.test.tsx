import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

// Use DOM drawing primitives so React validates the attributes forwarded to the browser.
vi.mock('react-native-svg', () => ({ default: 'svg', Path: 'path' }));

import { BrandMark } from './BrandMark';

afterEach(() => { vi.restoreAllMocks(); });

describe('BrandMark web accessibility', () => {
    it('keeps the decorative mark hidden without forwarding native accessibility attributes', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const markup = renderToStaticMarkup(<BrandMark color="#2457EA" />);

        expect(markup).toContain('aria-hidden="true"');
        expect(markup).toContain('focusable="false"');
        expect(markup).not.toContain('accessible=');
        expect(consoleError).not.toHaveBeenCalled();
    });
});
