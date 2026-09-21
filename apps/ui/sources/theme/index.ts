import { Platform } from 'react-native';
import {
    buildDarkShadowLevels,
    buildGlassBorderColor,
    buildGlassCastShadow,
    buildGlassInnerShadow,
    buildLightShadowLevels,
    buildShadowPopoverArrowBoxShadow,
} from '../shadowElevation';
import {
    buildLightStateColors,
    darkStateColors,
    LIGHT_STATE_INFO_FOREGROUND,
} from './tokens/stateColors';
import {
    darkSurfaceColors,
    darkTextColors,
    lightSurfaceColors,
    lightTextColors,
} from './tokens/surfaceAndTextColors';
import { createVerticalGradient } from './verticalGradient';

// The opt-in glass composer is a large surface, so its top inner-shadow reads a
// touch stronger than on the small floating chrome (tab bar / jump-to-bottom).
// Fade the composer's inner-shadow opacity slightly — COMPOSER ONLY; every other
// glass surface keeps the shared `glass.innerShadow` at full strength.
const COMPOSER_GLASS_INNER_SHADOW_OPACITY_SCALE = 0.7;

// Shared spacing, sizing constants (DRY - used by both themes)
const sharedSpacing = {
    // Spacing scale (based on actual usage patterns in codebase)
    margins: {
        xs: 4,   // Tight spacing, status indicators
        sm: 8,   // Small gaps, most common gap value
        md: 12,  // Button gaps, card margins
        lg: 16,  // Most common padding value
        xl: 20,  // Large padding
        xxl: 24, // Section spacing
    },

    // Border radii (based on actual usage patterns in codebase)
    borderRadius: {
        sm: 4,   // Checkboxes (20x20 boxes use 4px corners)
        md: 8,   // Buttons, items (most common - 31 uses)
        lg: 10,  // Input fields (matches "new session panel input fields")
        xl: 12,  // Cards, containers (20 uses)
        xxl: 16, // Main containers
        modalCard: 14, // Modal card surfaces (wizard shell, story deck)
    },

    // Icon sizes (based on actual usage patterns)
    iconSize: {
        small: 12,  // Inline icons (checkmark, lock, status indicators)
        medium: 16, // Section headers, add buttons
        large: 20,  // Action buttons (delete, duplicate, edit) - most common
        xlarge: 24, // Main section icons (desktop, folder)
    },
} as const;

export const lightTheme = {
    dark: false,
    colors: {

        //
        // Main colors
        //

        // `text.*` and `surface.*` are owned by `theme/tokens/surfaceAndTextColors.ts` for the same
        // reason `state.*` is: the Vitest theme mock must consume the same bytes rather than restate
        // them. See that module for the seven drifts restating produced.
        text: lightTextColors,
        accent: {
            blue: '#007AFF',
            green: '#34C759',
            orange: '#FF9500',
            yellow: '#FFCC00',
            red: '#FF3B30',
            indigo: Platform.select({ ios: '#5856D6', default: '#5C6BC0' }),
            purple: Platform.select({ ios: '#AF52DE', default: '#9C27B0' }),
        },
        // The `state.*` palette is owned by `theme/tokens/stateColors.ts` so the Vitest theme mock
        // consumes the same bytes instead of restating them (see that module for why it cannot
        // import this one). `foreground` tints glyphs, icons, borders and action indicators;
        // `onTint` is the ONLY correct colour for text sitting on the matching `background` tint.
        // `themeContrast.test.ts` is the arbiter of every recorded ratio.
        state: buildLightStateColors(Platform.select({
            ios: LIGHT_STATE_INFO_FOREGROUND.ios,
            default: LIGHT_STATE_INFO_FOREGROUND.default,
        })),
        background: {
            canvas: '#ffffff',
        },
        surface: lightSurfaceColors,
        // The keyboard focus indicator. Deliberately its own hue rather than an alias of
        // `state.active` or `accent.blue`: the ring's promise is >=3:1 against every surface the
        // app can put behind it (WCAG 2.2 SC 1.4.11 / 2.4.11), and an accent that gets re-tuned
        // for brand reasons cannot carry that promise. #0059B3 measures 6.82:1 on white down to
        // 4.69:1 on `border.strong`, which is the binding case. `focusRingContrast.test.ts` is the
        // arbiter.
        focus: {
            ring: '#0059B3',
        },
        border: {
            default: Platform.select({ ios: '#eaeaea', default: '#eaeaea' }),
            surface: '#eaeaea',
            strong: Platform.select({ ios: '#d6d6d6', default: '#d6d6d6' }),
            modal: 'rgba(0, 0, 0, 0.1)',
            // Half the weight of `default`, for seams and for controls whose border should imply an
            // edge without competing with the content inside it. Introduced for the sidebar/content
            // seam and shared by the quiet toolbar buttons rather than re-typed as a literal.
            subtle: 'rgba(0, 0, 0, 0.062)',
        },
        effect: {
            surfaceHighlight: 'transparent',
        },
        chrome: {
            header: {
                background: '#ffffff',
                foreground: lightTextColors.primary,
            },
        },
        overlay: {
            scrimSoft: 'rgba(0, 0, 0, 0.18)',
            scrim: 'rgba(0, 0, 0, 0.45)',
            scrimStrong: 'rgba(255, 255, 255, 0.68)',
            scrimWizard: 'rgba(255, 255, 255, 0.52)',
            foreground: '#FFFFFF',
            secondaryForeground: 'rgba(255, 255, 255, 0.9)',
        },
        desktopPetOverlay: {
            bubble: {
                background: '#FFFFFF',
                backgroundPressed: '#F7F7F7',
                text: '#1C1C1E',
                textSecondary: '#5F6368',
                controlBackground: 'rgba(255, 255, 255, 0.96)',
                controlBackgroundPressed: '#F2F2F7',
            },
        },
        /** Legacy tint helper (`Color(theme.colors.shadow.color)...`); prefer `shadowLevels` for cast shadows. */
        shadow: {
            color: '#000000',
            opacity: 0.1,
        },
        shadowLevels: buildLightShadowLevels(),
        shadowPopoverArrowBoxShadow: buildShadowPopoverArrowBoxShadow(false),
        // Shared recipe for floating glass surfaces (GlassPanel): tab bar, jump-to-
        // bottom button, glass composer, etc.
        glass: {
            border: buildGlassBorderColor(false),
            innerShadow: buildGlassInnerShadow(false),
            // Composer-only: a hair fainter than the shared `innerShadow`.
            composerInnerShadow: buildGlassInnerShadow(false, COMPOSER_GLASS_INNER_SHADOW_OPACITY_SCALE),
            castShadow: buildGlassCastShadow(false),
            // Glass composer fill: white on light (unchanged from `surface.base`).
            composerSurface: '#ffffff',
            // Near-white solid fallback for glass panels (e.g. the session-list
            // selection action bar) when blur is unavailable/off.
            panelSurface: '#fafafa',
            // Translucent tint behind the web `backdrop-filter` blur (GlassSurface webBlur
            // tier) — kept fairly transparent so the blurred content actually shows through
            // as frosted glass (too opaque reads as a flat panel over the light list).
            webBlurTint: 'rgba(255, 255, 255, 0.5)',
        },

        //
        // System components
        //

        switch: {
            track: {
                active: '#303030',
                inactive: '#dddddd',
            },
            thumb: {
                active: '#FFFFFF',
                inactive: '#767577',
            },
        },
        fab: {
            background: '#000000',
            backgroundPressed: '#1a1a1a',
            gradient: createVerticalGradient(['#000000', '#171717']),
            icon: '#FFFFFF',
        },
        segmentedControl: {
            trackBackground: '#f0f0f0',
            trackGradient: undefined,
            activeBackground: '#ffffff',
            activeGradient: createVerticalGradient(['#FDFDFD', '#FFFFFF']),
        },
        radio: {
            active: '#303030',
            inactive: '#C0C0C0',
            dot: '#303030',
        },
        button: {
            primary: {
                background: '#000000',
                gradient: createVerticalGradient(['#000000', '#020202']),
                tint: '#FFFFFF',
                disabled: '#C0C0C0',
            },
            secondary: {
                background: 'transparent',
                tint: '#666666',
            }
        },
        feed: {
            card: {
                background: '#f8f8f8',
            }
        },
        input: {
            background: lightSurfaceColors.base,
            text: lightTextColors.primary,
            placeholder: lightTextColors.placeholder,
        },
        composer: {
            chipTint: '#767676',
        },
        //
        // App components
        //

        status: {
            connected: '#34C759',
            connecting: '#007AFF',
            actionRequired: '#FF9500',
            disconnected: '#999999',
            error: '#FF3B30',
            default: '#8E8E93',
        },

        // Permission mode colors
        permission: {
            default: '#8E8E93',
            acceptEdits: '#007AFF',
            bypass: '#FF9500',
            plan: '#34C759',
            readOnly: '#8B8B8D',
            safeYolo: '#FF6B35',
            yolo: '#DC143C',
        },

        // Permission button colors
        permissionButton: {
            allow: {
                background: '#34C759',
                text: '#34C759',
            },
            deny: {
                background: '#FF3B30',
                text: '#FF3B30',
            },
            allowAll: {
                background: '#007AFF',
                text: '#007AFF',
            },
            inactive: {
                background: '#E5E5EA',
                border: '#D1D1D6',
                text: '#8E8E93',
            },
            selected: {
                background: '#F2F2F7',
                border: '#D1D1D6',
                text: '#3C3C43',
            },
        },


        // Diff view
        diff: {
            outline: '#E0E0E0',
            success: '#28A745',
            error: '#DC3545',
            added: {
                background: '#E6FFED',
                border: '#34D058',
                foreground: '#24292E',
            },
            removed: {
                background: '#FFEEF0',
                border: '#D73A49',
                foreground: '#24292E',
            },
            context: {
                background: '#F6F8FA',
                foreground: '#586069',
            },
            lineNumber: {
                background: '#F6F8FA',
                foreground: '#959DA5',
            },
            hunk: {
                background: '#F1F8FF',
                foreground: '#005CC5',
            },
            leadingSpaceDot: '#E8E8E8',
            inlineAdded: {
                background: '#ACFFA6',
                foreground: '#0A3F0A',
            },
            inlineRemoved: {
                background: '#FFCECB',
                foreground: '#5A0A05',
            },
        },

        // Message View colors
        message: {
            user: {
                background: '#171717',
                foreground: '#FFFFFF',
            },
            agent: {
                foreground: lightTextColors.primary,
            },
            event: {
                foreground: lightTextColors.secondary,
            },
        },

        // Code/Syntax colors
        syntax: {
            keyword: '#1d4ed8',
            string: '#059669',
            comment: '#6b7280',
            number: '#0891b2',
            function: '#9333ea',
            bracket1: '#ff6b6b',
            bracket2: '#4ecdc4',
            bracket3: '#45b7d1',
            bracket4: '#f7b731',
            bracket5: '#5f27cd',
            default: '#374151',
        },

        // Git status colors
        versionControl: {
            added: {
                foreground: '#22c55e',
                background: 'rgba(34, 197, 94, 0.12)',
            },
            removed: {
                foreground: '#ef4444',
                background: 'rgba(239, 68, 68, 0.12)',
            },
        },

    },

    ...sharedSpacing,
};

export const darkTheme = {
    dark: true,
    colors: {

        //
        // Main colors
        //

        // See the light theme: owned by `theme/tokens/surfaceAndTextColors.ts`.
        text: darkTextColors,
        accent: {
            blue: '#9EB9FF',
            green: '#66DC7E',
            orange: '#E0B65A',
            yellow: '#F1C96A',
            red: '#EE6E6C',
            indigo: '#8EA3FF',
            purple: '#C0A7FF',
        },
        // See `theme/tokens/stateColors.ts` for the `foreground` vs `onTint` split and the ratios.
        state: darkStateColors,
        background: {
            canvas: '#181818',
        },
        surface: darkSurfaceColors,
        // See the light theme for why this is a dedicated hue. #A9C2FF measures 10.07:1 on
        // `surface.base` down to 6.20:1 on `border.strong` over `surface.pressed`.
        focus: {
            ring: '#A9C2FF',
        },
        border: {
            default: 'rgba(255,255,255,0.050)',
            surface: 'rgba(255,255,255,0.056)',
            strong: 'rgba(255,255,255,0.090)',
            modal: 'rgba(255,255,255,0.064)',
            subtle: 'rgba(255,255,255,0.040)',
        },
        effect: {
            surfaceHighlight: 'transparent',
        },
        chrome: {
            header: {
                background: '#181818',
                foreground: '#EFEFEF',
            },
        },
        overlay: {
            scrimSoft: 'rgba(24,24,24,0.54)',
            scrim: 'rgba(24,24,24,0.72)',
            scrimStrong: 'rgba(24,24,24,0.86)',
            scrimWizard: 'rgba(24,24,24,0.78)',
            foreground: '#EFEFEF',
            secondaryForeground: '#a0a0a0',
        },
        desktopPetOverlay: {
            bubble: {
                background: '#292929',
                backgroundPressed: '#303030',
                text: '#EFEFEF',
                textSecondary: '#a0a0a0',
                controlBackground: 'rgba(41, 41, 41, 0.96)',
                controlBackgroundPressed: '#2e2e2e',
            },
        },
        shadow: {
            color: '#000000',
            opacity: 0.1,
        },
        shadowLevels: buildDarkShadowLevels(),
        shadowPopoverArrowBoxShadow: buildShadowPopoverArrowBoxShadow(true),
        glass: {
            border: buildGlassBorderColor(true),
            innerShadow: buildGlassInnerShadow(true),
            // Composer-only: a hair fainter than the shared `innerShadow`.
            composerInnerShadow: buildGlassInnerShadow(true, COMPOSER_GLASS_INNER_SHADOW_OPACITY_SCALE),
            castShadow: buildGlassCastShadow(true),
            // Glass composer fill: a lifted/elevated tone on dark so the dark glass
            // composer reads as raised glass (vs the flat `surface.base` = #202020).
            composerSurface: '#292929',
            // Solid grey-ish fill for opt-in glass panels — the same lifted/elevated
            // tone as the dark glass composer (already glass-ish vs the flat base).
            panelSurface: '#292929',
            // Translucent tint behind the web `backdrop-filter` blur — a frosted dark
            // (≈ `surface.base` #202020), kept transparent enough to read as glass.
            webBlurTint: 'rgba(32, 32, 32, 0.5)',
        },

        //
        // System components
        //

        switch: {
            track: {
                active: '#686868',
                inactive: '#303030',
            },
            thumb: {
                active: '#EFEFEF',
                inactive: '#8a8a8a',
            },
        },
        fab: {
            background: '#ededed',
            backgroundPressed: '#ffffff',
            gradient: createVerticalGradient(['#ededed', '#ffffff']),
            icon: '#202020',
        },
        segmentedControl: {
            trackBackground: '#242424',
            trackGradient: undefined,
            activeBackground: '#2e2e2e',
            activeGradient: createVerticalGradient(['#2e2e2e', '#2e2e2e']),
        },
        radio: {
            active: '#EFEFEF',
            inactive: '#8a8a8a',
            dot: '#EFEFEF',
        },
        button: {
            primary: {
                background: '#ededed',
                gradient: createVerticalGradient(['#ededed', '#ffffff']),
                tint: '#202020',
                disabled: '#303030',
            },
            secondary: {
                background: 'transparent',
                tint: '#EFEFEF',
            }
        },
        input: {
            background: '#191919',
            text: '#EFEFEF',
            placeholder: '#8a8a8a',
        },
        composer: {
            chipTint: '#a8a8a8',
        },
        feed: {
            card: {
                background: '#292929',
            }
        },
        //
        // App components
        //

        status: { // App Connection Status
            connected: '#66DC7E',
            connecting: '#9EB9FF',
            actionRequired: '#E0B65A',
            disconnected: '#a0a0a0',
            error: '#EE6E6C',
            default: '#a0a0a0',
        },

        // Permission mode colors
        permission: {
            default: '#a0a0a0',
            acceptEdits: '#66DC7E',
            bypass: '#E0B65A',
            plan: '#C0A7FF',
            readOnly: '#9EB9FF',
            safeYolo: '#F1C96A',
            yolo: '#EE6E6C',
        },

        // Permission button colors
        permissionButton: {
            allow: {
                background: '#66DC7E',
                text: '#66DC7E',
            },
            deny: {
                background: '#EE6E6C',
                text: '#EE6E6C',
            },
            allowAll: {
                background: '#9EB9FF',
                text: '#9EB9FF',
            },
            inactive: {
                background: '#181818',
                border: 'rgba(255,255,255,0.050)',
                text: '#a0a0a0',
            },
            selected: {
                background: '#2e2e2e',
                border: 'rgba(255,255,255,0.090)',
                text: '#EFEFEF',
            },
        },


        // Diff view
        diff: {
            outline: '#303030',
            success: '#66DC7E',
            error: '#EE6E6C',
            added: {
                background: 'rgba(102, 220, 126, 0.12)',
                border: '#66DC7E',
                foreground: '#E7F4EA',
            },
            removed: {
                background: 'rgba(238, 110, 108, 0.12)',
                border: '#EE6E6C',
                foreground: '#F4DEDE',
            },
            context: {
                background: '#191919',
                foreground: '#a0a0a0',
            },
            lineNumber: {
                background: '#191919',
                foreground: '#8a8a8a',
            },
            hunk: {
                background: 'rgba(158, 185, 255, 0.10)',
                foreground: '#9EB9FF',
            },
            leadingSpaceDot: '#303030',
            inlineAdded: {
                background: 'rgba(102, 220, 126, 0.16)',
                foreground: '#E7F4EA',
            },
            inlineRemoved: {
                background: 'rgba(238, 110, 108, 0.16)',
                foreground: '#F4DEDE',
            },
        },

        // Message View colors
        message: {
            user: {
                background: '#ededed',
                foreground: '#202020',
            },
            agent: {
                foreground: '#EFEFEF',
            },
            event: {
                foreground: '#a0a0a0',
            },
        },

        // Code/Syntax colors (brighter for dark mode)
        syntax: {
            keyword: '#9EB9FF',
            string: '#66DC7E',
            comment: '#8a8a8a',
            number: '#E0B65A',
            function: '#C0A7FF',
            bracket1: '#FFD700',
            bracket2: '#C0A7FF',
            bracket3: '#9EB9FF',
            bracket4: '#FF8C00',
            bracket5: '#66DC7E',
            default: '#EFEFEF',
        },

        // Git status colors
        versionControl: {
            added: {
                foreground: '#66DC7E',
                background: 'rgba(102, 220, 126, 0.15)',
            },
            removed: {
                foreground: '#EE6E6C',
                background: 'rgba(238, 110, 108, 0.15)',
            },
        },

    },

    ...sharedSpacing,
} satisfies typeof lightTheme;

export type Theme = typeof lightTheme;
