import { describe, expect, it } from 'vitest';
import { resolveSessionListRowHeight } from './sessionListRowDensity';

describe('minimal session row touch targets', () => {
    it.each(['ios', 'android', 'web'] as const)('keeps a phone %s row at least 48 pixels high', (platform) => {
        expect(resolveSessionListRowHeight({ compact: true, compactMinimal: true, isTablet: false, platform })).toBeGreaterThanOrEqual(48);
    });

    it('keeps minimal desktop web rows dense', () => {
        expect(resolveSessionListRowHeight({ compact: true, compactMinimal: true, isTablet: true, platform: 'web' })).toBe(34);
    });
});
