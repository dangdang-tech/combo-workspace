/** Reject external URLs and control characters in authentication continuations. */
export function normalizeInternalReturnTo(value: unknown): string | null {
    return typeof value === 'string' && /^\/(?!\/)/.test(value) && !/[\\\u0000-\u0020]/.test(value) ? value : null;
}

/** Preserve an internal continuation across the existing external-provider login. */
export function resolveAuthReturnToRoute(returnTo: unknown, pendingDesktopSetup: boolean): string {
    return normalizeInternalReturnTo(returnTo) ?? (pendingDesktopSetup ? '/setup' : '/');
}

/** Carry a validated continuation through an authentication or recovery screen. */
export function withAuthReturnTo(route: string, returnTo: unknown): string {
    const target = normalizeInternalReturnTo(returnTo);
    if (!target || target === '/') return route;
    return `${route}${route.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(target)}`;
}
