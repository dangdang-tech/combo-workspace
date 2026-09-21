/**
 * The `state.*` palette — one owner for the six semantic status roles in both themes.
 *
 * It lives outside `theme/index.ts` for one reason: the Vitest unistyles mock
 * (`sources/dev/vitestSetup.ts`) needs the same bytes, and it cannot import the real theme because
 * 450+ test files install their own partial `react-native` mock, against which the theme's
 * `Platform.select` calls would throw. This module therefore imports nothing at all, and the one
 * platform-dependent hue is exposed as an explicit pair the caller selects from.
 *
 * `sources/dev/vitestSetupThemeParity.test.ts` is the guard: a token added here but forgotten in a
 * consumer resolves to `undefined`, which renders as "no colour" and passes silently.
 *
 * Role split (PLAN §4.5): `foreground` tints glyphs, icons, borders and action indicators on
 * ordinary surfaces; `onTint` is the ONLY correct colour for text sitting on the matching
 * `background`. Contrast across the canonical surfaces is checked by
 * `components/ui/theme/themeContrast.test.ts`.
 */

export type ThemeStateColorRole = Readonly<{
    foreground: string;
    onTint: string;
    background: string;
    border: string;
}>;

export type ThemeStateColors = Readonly<{
    success: ThemeStateColorRole;
    warning: ThemeStateColorRole;
    danger: ThemeStateColorRole;
    info: ThemeStateColorRole;
    neutral: ThemeStateColorRole;
    active: ThemeStateColorRole;
}>;

/**
 * The only platform-split value in the palette: the glyph tint follows the platform's native
 * indigo, exactly as `accent.indigo` does. The `onTint` ink has no platform-native counterpart and
 * is a single value.
 */
export const LIGHT_STATE_INFO_FOREGROUND = {
    ios: '#5856D6',
    default: '#5C6BC0',
} as const;

export function buildLightStateColors(infoForeground: string): ThemeStateColors {
    return {
        success: {
            foreground: '#34C759',
            onTint: '#1A7030',
            background: 'rgba(52, 199, 89, 0.12)',
            border: '#34C759',
        },
        warning: {
            foreground: '#FF9500',
            onTint: '#B25000',   // 4.93:1 — opaque tint, surface-invariant
            background: '#FFF8F0',
            border: '#FF9500',
        },
        danger: {
            foreground: '#FF3B30',
            onTint: '#D70015',   // 4.86:1 — opaque tint, surface-invariant
            background: '#FFF0F0',
            border: '#FF3B30',
        },
        info: {
            foreground: infoForeground,
            // One indigo for both platforms: the ink role has no platform-native counterpart the
            // way the glyph tint does.
            onTint: '#454FB4',
            background: 'rgba(0, 122, 255, 0.10)',
            border: '#007AFF',
        },
        neutral: {
            foreground: '#8a8a8a',
            onTint: '#686868',   // Same readable ink as text.secondary on an opaque tint.
            background: '#f3f3f3',
            border: '#d6d6d6',
        },
        active: {
            foreground: '#303030',
            onTint: '#303030',
            background: '#eeeeee',
            border: '#d6d6d6',
        },
    };
}

/**
 * Four of the six dark hues already clear AA as text on their own tint, so `onTint` aliases them
 * rather than inventing a second value; only `neutral` and `danger` needed their own ink.
 */
export const darkStateColors: ThemeStateColors = {
    success: {
        foreground: '#66DC7E',
        onTint: '#66DC7E',
        background: 'rgba(102, 220, 126, 0.15)',
        border: '#66DC7E',
    },
    warning: {
        foreground: '#E0B65A',
        onTint: '#E0B65A',
        background: 'rgba(224, 182, 90, 0.15)',
        border: '#E0B65A',
    },
    danger: {
        foreground: '#EE6E6C',
        // Lighter ink preserves AA when the translucent danger tint sits over selected/pressed rows.
        onTint: '#F58F8D',
        background: 'rgba(238, 110, 108, 0.15)',
        border: '#EE6E6C',
    },
    info: {
        foreground: '#9EB9FF',
        onTint: '#9EB9FF',
        background: 'rgba(158, 185, 255, 0.14)',
        border: '#9EB9FF',
    },
    neutral: {
        foreground: '#a0a0a0',
        // Reuse the composer's readable neutral ink for tinted labels.
        onTint: '#a8a8a8',
        background: '#2e2e2e',
        border: '#3a3a3a',
    },
    active: {
        foreground: '#EFEFEF',
        onTint: '#EFEFEF',
        background: '#303030',
        border: '#484848',
    },
};
