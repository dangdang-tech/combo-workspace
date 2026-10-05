import {
    SESSION_LIST_ROW_HEIGHT_COMPACT,
    SESSION_LIST_ROW_HEIGHT_DEFAULT,
    SESSION_LIST_ROW_HEIGHT_MINIMAL,
    SESSION_LIST_ROW_HEIGHT_MINIMAL_PHONE,
} from './sessionListRowHeights';

export type SessionListRowPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos';
export type SessionListRowDensity = 'default' | 'compact' | 'minimal';

export const SESSION_LIST_ROW_CORNER_RADIUS = 10;

export const SESSION_LIST_ROW_TITLE_TEXT_METRICS = {
    default: { fontSize: 15, lineHeight: 22 },
    compact: { fontSize: 15, lineHeight: 22 },
    minimal: { fontSize: 14, lineHeight: 18 },
    minimalPhone: { fontSize: 15, lineHeight: 22 },
} as const;

export const SESSION_LIST_ROW_STATUS_TEXT_METRICS = {
    default: { fontSize: 13, lineHeight: 20 },
    compact: { fontSize: 11, lineHeight: 11 },
    minimal: { fontSize: 10, lineHeight: 12 },
} as const;

export const SESSION_LIST_ROW_IDENTITY_METRICS = {
    default: { slotSize: 48, agentLogoSize: 37 },
    compact: { slotSize: 30, agentLogoSize: 23 },
    minimal: { slotSize: 18, agentLogoSize: 14 },
    minimalPhone: { slotSize: 20, agentLogoSize: 16 },
} as const;

export function resolveSessionListRowTitleTextMetrics(params: Readonly<{
    density: SessionListRowDensity;
    readablePhoneMinimal: boolean;
}>): Readonly<{ fontSize: number; lineHeight: number }> {
    if (params.density === 'minimal' && params.readablePhoneMinimal) {
        return SESSION_LIST_ROW_TITLE_TEXT_METRICS.minimalPhone;
    }
    return SESSION_LIST_ROW_TITLE_TEXT_METRICS[params.density];
}

export function resolveSessionListRowIdentityMetrics(params: Readonly<{
    density: SessionListRowDensity;
    readablePhoneMinimal: boolean;
}>): Readonly<{ slotSize: number; agentLogoSize: number }> {
    if (params.density === 'minimal' && params.readablePhoneMinimal) {
        return SESSION_LIST_ROW_IDENTITY_METRICS.minimalPhone;
    }
    return SESSION_LIST_ROW_IDENTITY_METRICS[params.density];
}

export function shouldUseReadablePhoneMinimalSessionRow(params: Readonly<{
    compact: boolean;
    compactMinimal: boolean;
    isTablet: boolean;
    platform: SessionListRowPlatform | string;
}>): boolean {
    return params.compact
        && params.compactMinimal
        && !params.isTablet
        && (params.platform === 'ios' || params.platform === 'android' || params.platform === 'web');
}

export function resolveSessionListRowHeight(params: Readonly<{
    compact: boolean;
    compactMinimal: boolean;
    isTablet: boolean;
    platform: SessionListRowPlatform | string;
}>): number {
    if (shouldUseReadablePhoneMinimalSessionRow(params)) {
        return SESSION_LIST_ROW_HEIGHT_MINIMAL_PHONE;
    }
    if (params.compactMinimal) {
        return SESSION_LIST_ROW_HEIGHT_MINIMAL;
    }
    if (params.compact) {
        return SESSION_LIST_ROW_HEIGHT_COMPACT;
    }
    return SESSION_LIST_ROW_HEIGHT_DEFAULT;
}
