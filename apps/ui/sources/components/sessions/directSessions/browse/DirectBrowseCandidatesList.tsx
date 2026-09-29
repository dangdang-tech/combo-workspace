import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text, TextInput } from '@/components/ui/text/Text';
import { useResolvedItemDensity } from '@/components/ui/lists/useResolvedItemDensity';
import type { Theme } from '@/theme';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { normalizeSessionPathForProjectGrouping } from '@/sync/domains/session/listing/sessionListProjectGroupingKeys';

import {
    buildDirectBrowseCandidateDisplayTitle,
    buildDirectBrowseCandidateRightElement,
    buildDirectBrowseCandidateSubtitle,
    formatDirectBrowseCandidatePathLabel,
    readDirectBrowseCandidatePath,
} from './buildDirectBrowseCandidatePresentation';
import type { DirectBrowseCandidate } from './useDirectBrowseCandidates';

type AppTheme = Theme;

const stylesheet = StyleSheet.create((theme: AppTheme) => ({
    helperText: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        color: theme.colors.text.secondary,
        fontSize: 13,
    },
    searchContainer: {
        position: 'relative',
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 6,
    },
    searchInput: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.surface.inset,
        color: theme.colors.text.primary,
        fontSize: 13,
    },
    searchInputWithAugmentingIndicator: {
        paddingRight: 40,
    },
    searchAugmentingIndicator: {
        position: 'absolute',
        right: 22,
        top: 22,
    },
    toolbar: { padding: theme.margins.md, gap: theme.margins.md },
    heading: { ...Typography.rowTitle(), color: theme.colors.text.primary },
    directory: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.default },
    directoryChildren: { paddingLeft: theme.margins.md },
    loadingRow: {
        paddingVertical: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

export const DirectBrowseCandidatesList = React.memo(function DirectBrowseCandidatesList(props: Readonly<{
    candidates: readonly DirectBrowseCandidate[];
    groupByDirectory?: boolean;
    activityBadgeMode?: 'all' | 'running-only';
    loading: boolean;
    error: string | null;
    nextCursor: string | null;
    loadingMore: boolean;
    searchAugmenting: boolean;
    linkingSessionId: string | null;
    searchQuery: string;
    onSearchQueryChange: (value: string) => void;
    onSelectCandidate: (candidate: DirectBrowseCandidate) => void;
    onLoadMore: () => void;
}>) {
    const { theme } = useUnistyles() as { theme: AppTheme };
    const styles = stylesheet;
    const itemDensity = useResolvedItemDensity(undefined);
    const [view, setView] = React.useState<'projects' | 'recent'>('projects');
    const [expandedDirectories, setExpandedDirectories] = React.useState<ReadonlySet<string>>(() => new Set());
    const hasSearchQuery = props.searchQuery.trim().length > 0;

    const directoryGroups = React.useMemo(() => {
        if (!props.groupByDirectory) return [];
        const groups = new Map<string, { directory: string | null; candidates: DirectBrowseCandidate[] }>();
        // Preserve the provider's newest-first pages and the hook's merged search order.
        for (const candidate of props.candidates) {
            const directory = readDirectBrowseCandidatePath(candidate.details);
            const key = normalizeSessionPathForProjectGrouping(directory, undefined);
            const group = groups.get(key);
            if (group) group.candidates.push(candidate);
            else groups.set(key, { directory, candidates: [candidate] });
        }
        return Array.from(groups, ([key, group]) => ({ key, ...group }));
    }, [props.candidates, props.groupByDirectory]);
    const showDirectories = props.groupByDirectory && view === 'projects' && !props.loading && !props.error && props.candidates.length > 0;
    const renderCandidate = (candidate: DirectBrowseCandidate) => (
        <Item
            key={candidate.remoteSessionId}
            testID={`direct-session-candidate:${candidate.remoteSessionId}`}
            title={buildDirectBrowseCandidateDisplayTitle(candidate)}
            subtitle={buildDirectBrowseCandidateSubtitle(candidate, theme, itemDensity)}
            rightElement={buildDirectBrowseCandidateRightElement(candidate, theme, itemDensity, props.activityBadgeMode)}
            onPress={() => props.onSelectCandidate(candidate)}
            loading={props.linkingSessionId === candidate.remoteSessionId}
        />
    );
    const loadMore = props.nextCursor ? (
        <Item
            testID="direct-session-candidates-load-more"
            title={t('directSessions.browseLoadMore')}
            onPress={props.onLoadMore}
            loading={props.loadingMore}
        />
    ) : null;

    return (
        <ItemGroup>
            <View testID="direct-session-browser">
                <View style={styles.searchContainer}>
                    <TextInput
                        testID="direct-session-candidates-search-input"
                        value={props.searchQuery}
                        onChangeText={props.onSearchQueryChange}
                        placeholder={t('directSessions.browseSearchPlaceholder')}
                        placeholderTextColor={theme.colors.input.placeholder}
                        style={[styles.searchInput, props.searchAugmenting ? styles.searchInputWithAugmentingIndicator : null]}
                    />
                    {props.searchAugmenting ? (
                        <View testID="direct-session-candidates-search-augmenting" style={styles.searchAugmentingIndicator}>
                            <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                        </View>
                    ) : null}
                </View>

                <View style={styles.toolbar}>
                    <Text style={styles.heading}>{t('directSessions.browseCandidates')}</Text>
                    {props.groupByDirectory ? <SegmentedTabBar
                        tabs={[{ id: 'projects', label: t('directSessions.browseProjects') }, { id: 'recent', label: t('directSessions.browseRecent') }]}
                        activeTabId={view} onSelectTab={setView} testIDPrefix="direct-session-view" /> : null}
                </View>

                {props.loading ? (
                    <View style={styles.loadingRow}>
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                    </View>
                ) : props.error ? (
                    <View>
                        <Text style={styles.helperText}>{props.error}</Text>
                    </View>
                ) : props.candidates.length === 0 && hasSearchQuery ? (
                    <View>
                        <Text style={styles.helperText}>{t('directSessions.browseNoSearchResults')}</Text>
                    </View>
                ) : props.candidates.length === 0 ? (
                    <View>
                        <Text style={styles.helperText}>{t('directSessions.browseNoCandidates')}</Text>
                    </View>
                ) : showDirectories ? null : (
                    <>
                        {props.candidates.map(renderCandidate)}
                        {loadMore}
                    </>
                )}
            {showDirectories ? <>
                {directoryGroups.map(({ key, directory, candidates }) => {
                    const pathLabel = formatDirectBrowseCandidatePathLabel(directory);
                    const title = pathLabel?.split('/').filter(Boolean).at(-1) ?? pathLabel ?? t('directSessions.browseUnassignedDirectory');
                    return (
                        <View key={key} testID={`direct-session-directory:${key || 'unassigned'}`} style={styles.directory}>
                            <Item testID={`direct-session-directory-toggle:${key || 'unassigned'}`}
                                title={title} subtitle={pathLabel ?? undefined} subtitleLines={0}
                                icon={<Ionicons name="folder-outline" size={18} color={theme.colors.text.secondary} />}
                                rightElement={<Ionicons name={expandedDirectories.has(key) ? 'chevron-down' : 'chevron-forward'} size={18} color={theme.colors.text.secondary} />}
                                accessibilityState={{ expanded: expandedDirectories.has(key) }}
                                onPress={() => setExpandedDirectories(current => {
                                    const next = new Set(current);
                                    if (next.has(key)) next.delete(key); else next.add(key);
                                    return next;
                                })} />
                            {expandedDirectories.has(key) ? <View style={styles.directoryChildren}>{candidates.map(renderCandidate)}</View> : null}
                        </View>
                    );
                })}
                {loadMore}
            </> : null}
            </View>
        </ItemGroup>
    );
});
