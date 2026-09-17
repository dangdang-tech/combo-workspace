import { Redirect, useSegments } from 'expo-router';
import * as React from 'react';
import { useAuth } from '@/auth/context/AuthContext';
import { isPublicRouteForUnauthenticated } from '@/auth/routing/authRouting';

function isWorkspaceRoute(segments: readonly string[]): boolean {
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

/**
 * Gates the app shell behind the unauthenticated redirect check.
 *
 * This component subscribes to `useSegments()` (which changes per navigation) so that the
 * redirect decision stays live, but it is the ONLY navigation-subscribing owner in the root
 * layout render path. When no redirect is needed it returns its `children` unchanged — because
 * the parent (`RootLayout`) never re-renders on navigation, the child element reference is stable
 * and React skips re-rendering the entire Stack subtree. This is what stops every navigation from
 * re-rendering all mounted SceneViews.
 */
export function RootLayoutRedirectGate({ children }: { children: React.ReactNode }): React.ReactElement {
    const { isAuthenticated } = useAuth();
    const segments = useSegments();

    // Old bookmarks must not mount removed feature screens or their background consumers.
    if (!isWorkspaceRoute(segments)) {
        return <Redirect href="/" />;
    }

    // Avoid rendering protected screens for a frame during redirect.
    if (!isAuthenticated && !isPublicRouteForUnauthenticated(segments)) {
        return <Redirect href="/" />;
    }

    return <>{children}</>;
}
