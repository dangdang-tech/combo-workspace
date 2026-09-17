/**
 * Shared by the runtime redirect gate and Metro's route dependency resolver.
 * Keep one product route policy even when an obsolete URL remains a redirect.
 * @param {readonly string[]} segments
 */
function isWorkspaceRoute(segments) {
    const path = segments.filter((part) => !part.startsWith('(') && part !== 'index');
    const [root, section, detail] = path;
    if (!root) return true;
    if (['invite', 'oauth', 'restore', 'terminal', 'scan', 'account', 'setup', 'server'].includes(root)) return true;
    if (root === 'settings') return path.length === 1 || ['account', 'machines'].includes(section ?? '');
    if (root === 'machine') return path.length === 2;
    if (root === 'new') return path.length === 1 || (section === 'pick' && ['machine', 'path'].includes(detail ?? ''));
    if (root === 'session') {
        return path.length === 2 || ['info', 'details', 'transcript', 'entry-sharing', 'message'].includes(detail ?? '');
    }
    return false;
}

/** @param {string} relativePath */
function isWorkspaceRouteFile(relativePath) {
    if (!/\.[cm]?[jt]sx?$/.test(relativePath)) return true;
    const segments = relativePath.replace(/\\/g, '/').replace(/\.[cm]?[jt]sx?$/, '')
        .replace(/\.(web|native|ios|android)$/, '').split('/');
    if (segments.length === 1 && ['+native-intent', '+not-found', '+html', '+middleware'].includes(segments[0])) return true;
    if (segments[segments.length - 1] === '_layout') segments.pop();
    return isWorkspaceRoute(segments);
}

module.exports = { isWorkspaceRoute, isWorkspaceRouteFile };
