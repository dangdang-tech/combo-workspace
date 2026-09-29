import React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import type { SessionListViewItem } from '@/sync/domains/state/storage';
import { isSessionListPrimaryHeaderKind } from './sessionListPrimaryHeader';
import { Icon } from '@/components/ui/icons/Icon';

const stylesheet = StyleSheet.create((theme) => ({
    headerSection: {
        paddingHorizontal: 16,
        paddingTop: 4,
    },
    headerText: {
        fontSize: 12,
        fontWeight: '500',
        color: theme.colors.text.secondary,
    },
    groupHeaderSection: {
        paddingHorizontal: 16,
        paddingTop: 4,
    },
    groupHeaderTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text.secondary,
        flexShrink: 1,
    },
    headerRow: {
        minHeight: 28,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: 8,
    },
    headerLabelRow: {
        minHeight: 44,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        minWidth: 0,
        flexShrink: 1,
    },
    headerChevron: {
        marginLeft: 6,
        width: 14,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    groupHeaderTrailingActions: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 4,
        flexShrink: 0,
    },
}));

export const CollapsibleSectionHeader = React.memo(function CollapsibleSectionHeader(props: Readonly<{
    title: string;
    headerKind?: Extract<SessionListViewItem, { type: 'header' }>['headerKind'];
    collapsed: boolean;
    onPress: () => void;
    headerTestId: string;
    rightElement?: React.ReactNode;
}>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const headerChevronColor = theme.colors.text.secondary;
    const isPrimaryHeader = isSessionListPrimaryHeaderKind(props.headerKind);
    return (
        <View style={isPrimaryHeader ? styles.headerSection : styles.groupHeaderSection}>
            <View style={styles.headerRow}>
                <Pressable style={styles.headerLabelRow}
                    onPress={props.onPress}
                    testID={props.headerTestId}
                    accessibilityRole="button"
                    accessibilityLabel={props.title}
                    aria-expanded={!props.collapsed}>
                    <Text style={isPrimaryHeader ? styles.headerText : styles.groupHeaderTitle}>{props.title}</Text>
                    <View style={styles.headerChevron}>
                        <Icon
                            name={props.collapsed ? 'caret-right' : 'caret-down'}
                            size={14}
                            color={headerChevronColor}
                        />
                    </View>
                </Pressable>
                {props.rightElement ? (
                    <View style={styles.groupHeaderTrailingActions}>
                        {props.rightElement}
                    </View>
                ) : null}
            </View>
        </View>
    );
});
