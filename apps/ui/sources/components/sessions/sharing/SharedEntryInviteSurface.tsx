import React, { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { Text } from '@/components/ui/text/Text';
import { BrandWordmark } from '@/components/onboarding/unauthShell/BrandWordmark';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface.base },
    scrollContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: theme.margins.xl, paddingVertical: theme.margins.xxl * 2 },
    card: { width: '100%', gap: theme.margins.xxl },
    columns: { gap: theme.margins.xxl },
    columnsWide: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.margins.xxl * 2 },
    context: { minWidth: 0, gap: theme.margins.xl },
    contextWide: { flex: 1 },
    decision: { gap: theme.margins.lg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.default, paddingTop: theme.margins.xl },
    decisionWide: { width: 280, borderTopWidth: 0, borderLeftWidth: StyleSheet.hairlineWidth, paddingTop: 0, paddingLeft: theme.margins.xxl },
    brand: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    publication: { gap: theme.margins.md },
    title: { ...Typography.contentTitle(), color: theme.colors.text.primary },
    heading: { ...Typography.pageTitle(), color: theme.colors.text.primary },
    body: { ...Typography.bodyText(), color: theme.colors.text.secondary },
    detail: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    disclosure: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.margins.sm, borderRadius: theme.borderRadius.md },
    disclosureText: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    explanation: { gap: theme.margins.md },
    resources: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.margins.sm },
    resourcesText: { flex: 1, ...Typography.rowMeta(), color: theme.colors.text.secondary },
    conversation: { gap: theme.margins.md },
    eyebrow: { ...Typography.eyebrow(), color: theme.colors.text.secondary },
    status: { padding: theme.margins.lg, borderRadius: theme.borderRadius.xl, backgroundColor: theme.colors.surface.inset, gap: theme.margins.sm },
    statusHeading: { flexDirection: 'row', gap: theme.margins.sm, alignItems: 'center' },
    statusTitle: { flex: 1, ...Typography.rowTitle(), color: theme.colors.text.primary },
    action: { minHeight: 52, borderRadius: theme.borderRadius.xxl, justifyContent: 'center' },
    exit: { minHeight: 44, paddingHorizontal: theme.margins.md, justifyContent: 'center' },
    exitText: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
}));

function InvitePublication({ title, publisher }: { title: string; publisher?: string | null }) {
    const [expanded, setExpanded] = useState(false);
    // Imported chat titles can contain encoded spaces; keep all content as plain text.
    const displayTitle = title.replace(/&#(?:0*32|x0*20);|&nbsp;/gi, ' ');
    const collapsible = title.length > 80 || title.split(/\r?\n/).length > 3;
    return <View testID="shared-entry-publication" style={stylesheet.publication}>
        <View>
            <Text testID="shared-entry-title" accessibilityRole="header" selectable numberOfLines={collapsible && !expanded ? 2 : undefined} style={stylesheet.title}>{displayTitle}</Text>
            {collapsible ? <PressableSurface testID="shared-entry-title-toggle" style={stylesheet.disclosure}
                accessibilityLabel={t(expanded ? 'sharedEntry.inviteCollapseTitle' : 'sharedEntry.inviteExpandTitle')}
                accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}>
                <Text style={stylesheet.disclosureText}>{t(expanded ? 'sharedEntry.inviteCollapseTitle' : 'sharedEntry.inviteExpandTitle')}</Text>
            </PressableSurface> : null}
        </View>
        {publisher ? <Text testID="shared-entry-publisher" style={stylesheet.detail}>{t('sharedEntry.publisher')}{' '}{publisher}</Text> : null}
    </View>;
}

export type SharedEntryInviteStatus = Readonly<{ testID: string; title: string; detail?: string; loading?: boolean }>;
export type SharedEntryInviteSurfaceProps = Readonly<{
    title?: string | null;
    publisher?: string | null;
    description?: string | null;
    showExplanation: boolean;
    status: SharedEntryInviteStatus | null;
    action: React.ComponentProps<typeof RoundButton> | null;
    busy: boolean;
    onExit: () => void;
    onPreparationRetry?: () => void;
}>;

/** Shared by the real invitation controller and dev-only representative-state previews. */
export function SharedEntryInviteSurface(props: SharedEntryInviteSurfaceProps) {
    const { theme } = useUnistyles();
    const maxWidth = useLayoutMaxWidth();
    const { width } = useWindowDimensions();
    const hasContext = Boolean(props.title || props.showExplanation);
    const wide = width >= 900 && hasContext;
    const { title, publisher, description, status, action, busy } = props;
    return <ScrollView style={stylesheet.screen} contentContainerStyle={[stylesheet.scrollContent, width < 900 ? { paddingVertical: theme.margins.xxl } : null]}>
        <View testID="shared-entry-invite-card" style={[stylesheet.card, { maxWidth: hasContext ? maxWidth : Math.min(maxWidth, 560) }]}>
            <View style={stylesheet.brand}>
                <BrandWordmark height={28} />
                {action?.testID !== 'shared-entry-home' ? <PressableSurface testID="shared-entry-exit" style={stylesheet.exit}
                    accessibilityLabel={t('common.home')} onPress={props.onExit}>
                    <Text style={stylesheet.exitText}>{t('common.home')}</Text>
                </PressableSurface> : null}
            </View>
            <View style={[stylesheet.columns, wide ? stylesheet.columnsWide : null]}>
                {hasContext ? <View style={[stylesheet.context, wide ? stylesheet.contextWide : null]}>
                    {title ? <View style={stylesheet.conversation}>
                        <Text style={stylesheet.eyebrow}>{t('sharedEntry.inviteTitle')}</Text>
                        <InvitePublication key={title} title={title} publisher={publisher} />
                    </View> : null}
                    {props.showExplanation ? <View style={stylesheet.explanation}>
                        {!title ? <Text accessibilityRole="header" style={stylesheet.heading}>{t('sharedEntry.inviteTitle')}</Text> : null}
                        {description?.trim() ? <Text testID="shared-entry-description" style={stylesheet.body}>{description}</Text> : null}
                        <Text testID="shared-entry-purpose" style={stylesheet.detail}>{t('sharedEntry.inviteContextDetail')}</Text>
                        <View style={stylesheet.resources}>
                            <Ionicons name="folder-outline" size={18} color={theme.colors.text.secondary} />
                            <Text style={stylesheet.resourcesText}>{t('sharedEntry.inviteResourcesDetail')}</Text>
                        </View>
                    </View> : null}
                </View>
                : null}
                <View style={[stylesheet.decision, wide ? stylesheet.decisionWide : null]}>
                    {status ? <View style={stylesheet.status} accessibilityLiveRegion="polite">
                        <View style={stylesheet.statusHeading}>
                            {status.loading ? <ActivitySpinner size="small" color={theme.colors.text.secondary} /> : null}
                            <Text testID={status.testID} style={stylesheet.statusTitle}>{status.title}</Text>
                        </View>
                        {status.detail ? <Text testID="shared-entry-state-detail" selectable style={stylesheet.detail}>{status.detail}</Text> : null}
                    </View> : null}
                    {action ? <RoundButton {...action} accessibilityLabel={action.title} size="normal" style={stylesheet.action}
                        disabled={busy || action.disabled === true} loading={busy || action.loading === true} /> : null}
                    {props.onPreparationRetry ? <PressableSurface testID="shared-entry-preparation-retry" style={stylesheet.exit}
                        accessibilityRole="button" accessibilityLabel={t('common.retry')} disabled={busy} onPress={props.onPreparationRetry}>
                        <Text style={stylesheet.exitText}>{t('common.retry')}</Text>
                    </PressableSurface> : null}
                </View>
            </View>
        </View>
    </ScrollView>;
}
