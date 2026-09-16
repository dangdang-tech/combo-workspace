import { describe, expect, it } from 'vitest';
import { resolveAuthReturnToRoute } from './resolveAuthReturnToRoute';

describe('resolveAuthReturnToRoute', () => {
    it('preserves the invite and target server through provider login', () => {
        expect(resolveAuthReturnToRoute('/invite/abc?server=https%3A%2F%2Frelay.example', false))
            .toBe('/invite/abc?server=https%3A%2F%2Frelay.example');
    });
    it.each(['https://evil.example', '//evil.example', '/\\evil.example', '\n/invite/abc'])('rejects unsafe return route %s', (path) => {
        expect(resolveAuthReturnToRoute(path, false)).toBe('/');
    });
    it('keeps desktop setup fallback without an explicit return route', () => {
        expect(resolveAuthReturnToRoute(undefined, true)).toBe('/setup');
        expect(resolveAuthReturnToRoute(undefined, false)).toBe('/');
    });
});
