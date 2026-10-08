/** Preserve old share-link intent without enabling the removed viewer route. */
export function resolveLegacyShareLinkRedirect(segments: readonly string[], pathname: string): `/invite/${string}` | null {
    const path = segments.filter((part) => !part.startsWith('(') && part !== 'index');
    if (path.length !== 2 || path[0] !== 'share' || path[1] !== '[token]') return null;

    const match = /^\/share\/([^/?#]+)\/?$/.exec(pathname);
    if (!match) return null;

    try {
        const token = decodeURIComponent(match[1]).trim();
        if (!token || token === 'codex' || token === ':token' || token === '[token]') return null;
        return `/invite/${encodeURIComponent(token)}`;
    } catch {
        return null;
    }
}
