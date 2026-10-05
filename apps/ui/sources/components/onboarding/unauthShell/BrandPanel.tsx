import * as React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useLocalSetting } from '@/sync/store/hooks';

import { BrandSubTagline } from './BrandSubTagline';
import { BrandTagline } from './BrandTagline';
import { BrandWordmark } from './BrandWordmark';
import { useBrandPaneTokens } from './brandPaneTokens';

export type BrandPanelProps = Readonly<{
    variant: 'desktop' | 'mobile-hero';
    onGetStarted?: () => void;
    testID?: string;
}>;

/** A labelled relationship diagram, without simulated chat content or nested cards. */
function SharedWorkspaceIllustration() {
    const tokens = useBrandPaneTokens();
    return <View style={[styles.workspace, { borderColor: tokens.border }]}>
        <View style={styles.projectRow}>
            <Icon name="folder" size={20} color={tokens.accent} />
            <Text style={[styles.projectTitle, { color: tokens.foreground }]}>{t('welcome.frontDoorProject')}</Text>
        </View>
        <View style={styles.conversations}>
            {[t('welcome.frontDoorYourConversation'), t('welcome.frontDoorOtherConversation')].map(label =>
                <View key={label} style={styles.conversation}>
                    <Icon name="chat-circle" size={18} color={tokens.foregroundSoft} />
                    <Text style={[styles.conversationLabel, { color: tokens.foregroundSoft }]}>{label}</Text>
                </View>)}
        </View>
    </View>;
}

/** Brand and product explanation live in the existing pre-auth shell. */
export const BrandPanel = React.memo(function BrandPanel(props: BrandPanelProps) {
    const safeAreaInsets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const tokens = useBrandPaneTokens();
    const returning = useLocalSetting('hasCompletedAuthOnce');
    const mobile = props.variant === 'mobile-hero';
    const compact = mobile || width < 1100;

    return (
        <View testID={props.testID ?? 'unauth-shell-brand-pane'} style={[styles.root, { backgroundColor: tokens.background }]}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                contentContainerStyle={styles.scrollContent}
            >
                <View
                    testID={mobile ? 'unauth-shell-brand-content-mobile' : 'unauth-shell-brand-content-desktop'}
                    style={[
                        styles.content,
                        compact ? styles.contentCompact : styles.contentDesktop,
                        mobile ? {
                            paddingTop: 24 + safeAreaInsets.top,
                            paddingLeft: 24 + safeAreaInsets.left,
                            paddingRight: 24 + safeAreaInsets.right,
                            paddingBottom: 28 + safeAreaInsets.bottom,
                        } : null,
                    ]}
                >
                    <View style={styles.wordmark}><BrandWordmark height={mobile ? 30 : 32} /></View>
                    <View style={styles.story}>
                        <View style={styles.eyebrowRow}>
                            <View style={[styles.eyebrowLine, { backgroundColor: tokens.accent }]} />
                            <Text style={[styles.eyebrow, { color: tokens.accent }]}>{t('welcome.frontDoorEyebrow')}</Text>
                        </View>
                        <BrandTagline mobile={compact || returning} />
                        {!returning ? <>
                            <BrandSubTagline mobile={mobile} />
                            <SharedWorkspaceIllustration />
                        </> : null}
                        <View style={styles.hostNote}>
                            <Icon name="desktop" size={18} color={tokens.foregroundSoft} />
                            <Text style={[styles.hostNoteText, { color: tokens.foregroundSoft }]}>{t('welcome.frontDoorHostRequirement')}</Text>
                        </View>
                    </View>
                    <View style={styles.footer}>
                        {mobile ? (
                            <RoundButton
                                size="large"
                                display="default"
                                title={t('welcome.brandHeroGetStarted')}
                                onPress={props.onGetStarted}
                                testID="brand-hero-get-started"
                                accessibilityLabel={t('welcome.brandHeroGetStarted')}
                            />
                        ) : null}
                    </View>
                </View>
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, minHeight: 0 },
    scrollContent: { flexGrow: 1 },
    content: { flexGrow: 1, gap: theme.margins.xxl },
    contentDesktop: { padding: theme.margins.xxl * 2, alignItems: 'center' },
    contentCompact: { padding: theme.margins.xxl },
    wordmark: { width: '100%', maxWidth: 520 },
    story: { width: '100%', maxWidth: 520, gap: theme.margins.lg },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: theme.margins.md },
    eyebrowLine: { height: 2, width: 24 },
    eyebrow: { ...Typography.eyebrow(), flexShrink: 1 },
    workspace: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: theme.margins.lg, gap: theme.margins.md },
    projectRow: { flexDirection: 'row', alignItems: 'center', gap: theme.margins.sm },
    projectTitle: { ...Typography.rowTitle(), flex: 1 },
    conversations: { gap: theme.margins.sm, paddingLeft: theme.margins.xxl },
    conversation: { flexDirection: 'row', alignItems: 'center', gap: theme.margins.sm },
    conversationLabel: { ...Typography.rowMeta(), flexShrink: 1 },
    hostNote: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.margins.sm },
    hostNoteText: { ...Typography.rowMeta(), flex: 1 },
    footer: { gap: theme.margins.xxl },
}));
