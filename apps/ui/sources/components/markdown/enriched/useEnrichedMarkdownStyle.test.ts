import type { TextStyle } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { Typography } from '@/constants/Typography';
import { lightTheme } from '@/theme';
import { parseThemeColor, themeContrastRatio } from '@/theme/themeContrastMath';

import { buildEnrichedMarkdownStyle } from './useEnrichedMarkdownStyle';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const colors = {
    text: { primary: '#111111', secondary: '#666666', link: '#0066cc' },
    surface: { inset: '#eeeeee', elevated: '#ffffff', selected: '#dddddd' },
    border: { default: '#cccccc' },
} as const;

type WebUnistylesTextStyle = TextStyle & Record<`unistyles_${string}`, unknown>;

// Mirrors the transcript's real web textStyle: a Unistyles-registered style whose numeric
// metrics are non-enumerable, non-writable (but configurable) data properties.
function createWebUnistylesTextStyle(values: Readonly<Pick<TextStyle, 'fontSize' | 'lineHeight' | 'color'>>): WebUnistylesTextStyle {
    const style: WebUnistylesTextStyle = { unistyles_test: {} };
    Object.defineProperties(
        style,
        Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
            value,
            enumerable: false,
            configurable: true,
        }])),
    );
    return style;
}

describe('buildEnrichedMarkdownStyle uiFontScale', () => {
    it('scales the markdown metrics from a plain transcript textStyle', () => {
        const bundle = buildEnrichedMarkdownStyle({
            colors,
            profile: 'transcript',
            uiFontScale: 1.3,
            textStyle: { fontSize: 16, lineHeight: 24 },
        });

        expect(bundle.markdownStyle.paragraph?.fontSize).toBe(20.8);
        expect(bundle.markdownStyle.paragraph?.lineHeight).toBe(31.2);
        expect(bundle.markdownStyle.codeBlock?.fontSize).toBe(18.2);
    });

    it('scales the markdown metrics from a web Unistyles transcript textStyle', () => {
        const bundle = buildEnrichedMarkdownStyle({
            colors,
            profile: 'transcript',
            uiFontScale: 1.3,
            textStyle: createWebUnistylesTextStyle({ fontSize: 16, lineHeight: 24 }),
        });

        expect(bundle.markdownStyle.paragraph?.fontSize).toBe(20.8);
        expect(bundle.markdownStyle.paragraph?.lineHeight).toBe(31.2);
        expect(bundle.markdownStyle.list?.fontSize).toBe(20.8);
        expect(bundle.markdownStyle.h1?.fontSize).toBe(31.2);
    });

    it('keeps the unscaled metrics at scale 1', () => {
        const bundle = buildEnrichedMarkdownStyle({
            colors,
            profile: 'transcript',
            uiFontScale: 1,
            textStyle: createWebUnistylesTextStyle({ fontSize: 16, lineHeight: 24 }),
        });

        expect(bundle.markdownStyle.paragraph?.fontSize).toBe(16);
        expect(bundle.markdownStyle.paragraph?.lineHeight).toBe(24);
    });

    it('preserves non-enumerable web foregrounds and scaled metrics when composing table-cell styles', () => {
        const style = buildEnrichedMarkdownStyle({
            colors,
            profile: 'transcript',
            uiFontScale: 1.3,
            textStyle: [
                { color: colors.text.primary },
                [createWebUnistylesTextStyle({ fontSize: 18, lineHeight: 24, color: '#ffffff' })],
            ],
        }).markdownStyle;

        expect(style.paragraph?.color).toBe('#ffffff');
        expect(style.paragraph?.fontSize).toBe(23.4);
        expect(style.paragraph?.lineHeight).toBe(31.2);
    });
});

describe('buildEnrichedMarkdownStyle foreground contrast', () => {
    const build = (profile: 'transcript' | 'thinking' = 'transcript', color?: string) => buildEnrichedMarkdownStyle({
        colors: lightTheme.colors,
        profile,
        uiFontScale: 1,
        textStyle: color ? { color } : undefined,
    }).markdownStyle;

    it('keeps code and table headers readable on their own light surfaces inside a dark user bubble', () => {
        const style = build('transcript', lightTheme.colors.message.user.foreground);
        for (const [ink, surface] of [
            [style.code?.color, style.code?.backgroundColor],
            [style.codeBlock?.color, style.codeBlock?.backgroundColor],
            [style.table?.headerTextColor, style.table?.headerBackgroundColor],
        ]) {
            expect(ink).toBe(lightTheme.colors.text.primary);
            expect(themeContrastRatio(parseThemeColor(String(ink)), parseThemeColor(String(surface)))).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('preserves bubble foreground on transparent quotes, checked tasks, and thinking code', () => {
        const foreground = lightTheme.colors.message.user.foreground;
        const style = build('thinking', foreground);
        expect(style.paragraph?.color).toBe(foreground);
        expect(style.blockquote?.color).toBe(foreground);
        expect(style.taskList?.checkedTextColor).toBe(foreground);
        expect(style.code?.color).toBe(foreground);
        expect(style.codeBlock?.color).toBe(foreground);
        expect(style.code?.backgroundColor).toBe('transparent');
        expect(style.codeBlock?.backgroundColor).toBe('transparent');
    });

    it('lets web inline formatting and underlined links inherit the containing bubble or table header foreground', () => {
        const style = build('transcript', lightTheme.colors.message.user.foreground);
        for (const inline of [style.strong, style.em, style.link, style.strikethrough, style.underline, style.inlineMath]) {
            expect(inline?.color).toBe('inherit');
        }
        expect(style.link?.underline).toBe(true);
    });

    it('retains themed secondary and link colors when no foreground override is present', () => {
        const style = build();
        expect(style.blockquote?.color).toBe(lightTheme.colors.text.secondary);
        expect(style.link?.color).toBe(lightTheme.colors.text.link);
        expect(style.strong?.color).toBe(lightTheme.colors.text.primary);
        expect(style.taskList?.checkedTextColor).toBe(lightTheme.colors.text.secondary);
    });

    it('keeps explicit system-font weight and italic style instead of assuming every font family embeds its variant', () => {
        const style = build();
        expect(style.strong?.fontFamily).toContain('system-ui');
        expect(style.strong?.fontWeight).toBe(Typography.default('semiBold').fontWeight);
        expect(style.strong?.fontWeight).not.toBe('normal');
        expect(style.em?.fontStyle).toBe('italic');
    });
});
