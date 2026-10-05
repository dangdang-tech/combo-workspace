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
import { BrandWordmark } from './BrandWordmark';
import { useBrandPaneTokens } from './brandPaneTokens';

export type BrandPanelProps = Readonly<{
    variant: 'desktop' | 'mobile-hero';
    onGetStarted?: () => void;
    testID?: string;
}>;

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
                            justifyContent: 'flex-start',
                            gap: 28,
                            paddingTop: 24 + safeAreaInsets.top,
                            paddingLeft: 24 + safeAreaInsets.left,
                            paddingRight: 24 + safeAreaInsets.right,
                            paddingBottom: 28 + safeAreaInsets.bottom,
                        } : null,
                    ]}
                >
                    <BrandWordmark height={mobile ? 30 : 32} />
                    <View style={styles.story}>
                        <BrandTagline mobile={compact} />
                        <BrandSubTagline mobile={mobile} />
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

const styles = StyleSheet.create(() => ({
    root: { flex: 1, minHeight: 0 },
    scrollContent: { flexGrow: 1 },
    content: { flexGrow: 1, justifyContent: 'center', gap: 40 },
    contentDesktop: { padding: 56 },
    contentCompact: { padding: 32 },
    story: { width: '100%', maxWidth: 520, gap: 20, paddingVertical: 0 },
    hostNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    hostNoteText: { ...Typography.rowMeta(), flex: 1 },
    footer: { gap: 22 },
}));
