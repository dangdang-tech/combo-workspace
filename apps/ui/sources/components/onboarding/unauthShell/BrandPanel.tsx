import * as React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { BrandSubTagline } from './BrandSubTagline';
import { BrandTagline } from './BrandTagline';
import { BrandTrustStrip } from './BrandTrustStrip';
import { BrandWordmark } from './BrandWordmark';
import { useBrandPaneTokens } from './brandPaneTokens';

export type BrandPanelProps = Readonly<{
    variant: 'desktop' | 'mobile-hero';
    onGetStarted?: () => void;
    testID?: string;
}>;

/** A static explanation of the sharing model, never a simulated live session. */
function SharedWorkspaceIllustration() {
    const tokens = useBrandPaneTokens();
    return (
        <View style={[styles.workspace, { borderColor: tokens.border, backgroundColor: tokens.surface }]}>
            <View style={[styles.projectRow, { borderBottomColor: tokens.border }]}>
                <View style={[styles.projectIcon, { backgroundColor: tokens.accentSurface }]}>
                    <Icon name="folder" size={22} color={tokens.accent} />
                </View>
                <Text style={[styles.projectTitle, { color: tokens.foreground }]}>{t('welcome.frontDoorProject')}</Text>
            </View>
            <View style={styles.conversations}>
                {[t('welcome.frontDoorYourConversation'), t('welcome.frontDoorOtherConversation')].map((label) => (
                    <View key={label} style={[styles.conversation, { backgroundColor: tokens.background, borderColor: tokens.border }]}>
                        <Icon name="chat-circle" size={22} color={tokens.accent} />
                        <Text style={[styles.conversationLabel, { color: tokens.foreground }]}>{label}</Text>
                        <View aria-hidden={true} style={styles.messageLines}>
                            <View style={[styles.messageLine, { backgroundColor: tokens.border }]} />
                            <View style={[styles.messageLineShort, { backgroundColor: tokens.accentSurface }]} />
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
}

/** Brand and product explanation live in the existing pre-auth shell. */
export const BrandPanel = React.memo(function BrandPanel(props: BrandPanelProps) {
    const safeAreaInsets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const tokens = useBrandPaneTokens();
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
                    <BrandWordmark height={mobile ? 30 : 32} />
                    <View style={styles.story}>
                        <View style={styles.eyebrowRow}>
                            <View style={[styles.eyebrowLine, { backgroundColor: tokens.accent }]} />
                            <Text style={[styles.eyebrow, { color: tokens.accent }]}>{t('welcome.frontDoorEyebrow')}</Text>
                        </View>
                        <BrandTagline mobile={compact} />
                        <BrandSubTagline mobile={mobile} />
                        <SharedWorkspaceIllustration />
                        <View style={styles.hostNote}>
                            <Icon name="desktop" size={18} color={tokens.foregroundSoft} />
                            <Text style={[styles.hostNoteText, { color: tokens.foregroundSoft }]}>{t('welcome.frontDoorHostRequirement')}</Text>
                        </View>
                    </View>
                    <View style={styles.footer}>
                        <BrandTrustStrip mobile={mobile} />
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

const styles = StyleSheet.create(() => ({
    root: { flex: 1, minHeight: 0 },
    scrollContent: { flexGrow: 1 },
    content: { flexGrow: 1, justifyContent: 'space-between', gap: 36 },
    contentDesktop: { padding: 56 },
    contentCompact: { padding: 32 },
    story: { width: '100%', maxWidth: 650, gap: 22, paddingVertical: 12 },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    eyebrowLine: { height: 2, width: 28 },
    eyebrow: { ...Typography.eyebrow(), flexShrink: 1 },
    workspace: { borderWidth: 1, borderRadius: 20, overflow: 'hidden', marginTop: 6 },
    projectRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderBottomWidth: 1 },
    projectIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    projectTitle: { ...Typography.rowTitle(), flex: 1 },
    conversations: { flexDirection: 'row', gap: 12, padding: 16 },
    conversation: { flex: 1, minWidth: 0, gap: 10, borderWidth: 1, borderRadius: 12, padding: 14 },
    conversationLabel: { ...Typography.rowTitle() },
    messageLines: { gap: 8, marginTop: 4 },
    messageLine: { width: '90%', height: 5, borderRadius: 3 },
    messageLineShort: { width: '65%', height: 5, borderRadius: 3 },
    hostNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    hostNoteText: { ...Typography.rowMeta(), flex: 1 },
    footer: { gap: 22 },
}));
