import { describe, expect, it } from 'vitest';
import { resolveLegacyShareLinkRedirect } from './legacyShareLinkRedirect';

describe('resolveLegacyShareLinkRedirect', () => {
    it('does not capture a static share route', () => {
        expect(resolveLegacyShareLinkRedirect(['share', 'foo'], '/share/foo')).toBeNull();
    });

    it.each([
        ['/share/abc123', '/invite/abc123'],
        ['/share/%20abc123%20/', '/invite/abc123'],
        ['/share/a%20b', '/invite/a%20b'],
        ['/share/a%2Fb', '/invite/a%2Fb'],
        ['/share/%', null],
        ['/share/', null],
        ['/share/%20', null],
        ['/share/%63odex', null],
        ['/share/%3Atoken', null],
        ['/share/%5Btoken%5D', null],
        ['/share/abc/extra', null],
        ['/share/abc?query', null],
        ['/share/abc#hash', null],
        ['/invite/abc', null],
    ])('resolves %s to %s', (pathname, expected) => {
        expect(resolveLegacyShareLinkRedirect(['(app)', 'share', '[token]'], pathname)).toBe(expected);
    });

    it.each([['share'], ['share', 'codex'], ['share', '[token]', 'extra'], ['session', '[id]', 'files']])(
        'ignores non-legacy route segments %j', (...segments) => {
            expect(resolveLegacyShareLinkRedirect(segments, '/share/abc')).toBeNull();
        },
    );
});
