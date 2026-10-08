import * as React from 'react';
import { Redirect, Stack } from 'expo-router';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { BrandMark } from '@/components/ui/icons/BrandMark';
import { BrandWordmark } from '@/components/onboarding/unauthShell/BrandWordmark';
import { MessageView } from '@/components/sessions/transcript/MessageView';
import { AgentInput } from '@/components/sessions/agentInput/AgentInput';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { Text } from '@/components/ui/text/Text';
import { PermissionFooter } from '@/components/tools/shell/permissions/PermissionFooter';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { t } from '@/text';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';
import { Typography } from '@/constants/Typography';

const noSuggestions = async () => [];

/** Local-only visual fixture. It neither redeems an invite nor calls a model. */
export default function ComboSharingPreview() {
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const [fixture, setFixture] = React.useState<'normal' | 'running' | 'offline' | 'approval' | 'failure'>('normal');
    const [draft, setDraft] = React.useState('');
    const [sent, setSent] = React.useState<string[]>([]);
    const narrow = width < 600;
    const fixtureNow = Date.now();
    const fixtureRuntimeStatus = getSessionStatus({
        id: 'combo-synthetic-visual-preview', seq: 1, createdAt: 0, updatedAt: fixtureNow,
        active: true, activeAt: fixtureNow, presence: 'online',
        metadata: null, metadataVersion: 0, agentState: null, agentStateVersion: 0,
        thinking: fixture === 'running', thinkingAt: fixtureNow,
    }, fixtureNow, { workingTextMode: 'static' });
    const send = () => {
        const value = draft.trim();
        if (!value || fixture === 'offline') return;
        setSent(previous => [...previous, value]);
        setDraft('');
    };

    if (!__DEV__) return <Redirect href="/" />;
    return <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
            <View style={styles.headerInner}>
                <BrandWordmark height={25} />
                <Text style={styles.headerProject} numberOfLines={1}>家庭小助手</Text>
            </View>
        </View>
        <View style={styles.fixtureControls}>
            <Text style={styles.fixtureNote}>Synthetic state selector · no execution</Text>
            <View style={styles.fixtureOptions}>
                {(['normal', 'running', 'offline', 'approval', 'failure'] as const).map(state =>
                    <PressableSurface key={state} accessibilityRole="button" accessibilityLabel={`Preview ${state}`}
                        onPress={() => setFixture(state)} style={styles.fixtureChoice}>
                        <Text style={styles.headerProject}>{state}</Text>
                    </PressableSurface>)}
            </View>
        </View>
        <ScrollView style={styles.transcript} contentContainerStyle={[styles.transcriptContent, narrow ? styles.transcriptPhone : null]}>
            <View style={styles.context}>
                <Text style={styles.contextLabel}>共享项目</Text>
                <Text style={styles.contextTitle}>和 COMBO 聊一聊</Text>
                <Text style={styles.contextDetail}>共享项目文件，保留你自己的对话。</Text>
            </View>
            <MessageView sessionId="combo-synthetic-visual-preview" metadata={null} message={{ kind: 'user-text', id: 'synthetic-question', localId: null, createdAt: 0, text: '帮我安排一下周末，好吗？' }} />
            <View style={styles.reply}>
            <View style={styles.replyIdentity}>
                <BrandMark size={18} color={theme.colors.accent.blue} />
                <Text style={styles.replyName}>COMBO</Text>
            </View>
            <MessageView sessionId="combo-synthetic-visual-preview" metadata={null} message={{ kind: 'agent-text', id: 'synthetic-reply', localId: null, createdAt: 0, text: '当然可以。我们先把周末分成三段，不必安排得太满。周六上午去附近公园走走，下午整理照片，晚上留一点时间休息。\n\n- 上午 09:30：散步 30 分钟，带上水。\n- 下午：整理 2026 年的照片，保存为 JPG。\n- 晚上：和家人聊天，听一首喜欢的歌。\n\n如果天气不好，就把散步换成在家做简单伸展。COMBO 可以继续帮你整理清单，不需要一次完成所有事情。' }} />
            </View>
            {(fixture === 'running' || fixture === 'failure') ? <MessageView sessionId="combo-synthetic-visual-preview" metadata={null}
                message={{ kind: 'tool-call', id: 'synthetic-tool', localId: null, createdAt: 0, children: [], tool: {
                    name: 'Bash', state: fixture === 'running' ? 'running' : 'error', input: { command: 'pwd' },
                    createdAt: 0, startedAt: 0, completedAt: fixture === 'failure' ? 1 : null,
                    description: 'Synthetic tool result', result: fixture === 'failure' ? 'Synthetic task failure — no command was executed.' : undefined,
                } }} /> : null}
            {fixture === 'approval' ? <PermissionFooter sessionId="combo-synthetic-visual-preview" metadata={null}
                permission={{ id: 'synthetic-approval', status: 'pending' }} toolName="Bash" toolInput={{ command: 'pwd' }}
                canApprovePermissions={false} disabledReason="notGranted" /> : null}
            {sent.map((text, index) => <MessageView key={index} sessionId="combo-synthetic-visual-preview" metadata={null} message={{ kind: 'user-text', id: `synthetic-${index}`, localId: null, createdAt: 0, text } satisfies Message} />)}
        </ScrollView>
        <View style={styles.composerArea}>
            {fixture === 'offline' ? <Text accessibilityLiveRegion="polite" style={styles.contextDetail}>{t('sharedEntry.hostOffline')}</Text> : null}
            <AgentInput isSendDisabled={fixture === 'offline'} connectionStatus={fixture === 'running' ? {
                text: fixtureRuntimeStatus.statusText, color: fixtureRuntimeStatus.statusColor,
                dotColor: fixtureRuntimeStatus.statusDotColor, isPulsing: fixtureRuntimeStatus.isPulsing,
            } : undefined} value={draft} onChangeText={setDraft} onSend={send}
                placeholder="说点什么…" autocompleteKinds={[]}
                autocompleteSuggestions={noSuggestions} submitAccessibilityLabel="Add message to local preview" contentPaddingHorizontal={0}
                maxWidthCap={720} />
            <Text style={styles.fixtureNote}>Production components · synthetic data · no model request</Text>
        </View>
    </View>;
}

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface.base },
    header: { alignItems: 'center' },
    headerInner: { width: '100%', maxWidth: 760, minHeight: 66, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20 },
    headerProject: { ...Typography.rowMeta(), color: theme.colors.text.secondary, flexShrink: 1 },
    transcript: { flex: 1 },
    transcriptContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 0, paddingTop: 34, paddingBottom: 30, gap: 12 },
    transcriptPhone: { paddingHorizontal: 0, paddingTop: 26, gap: 12 },
    context: { gap: 8, marginHorizontal: 20, paddingBottom: 12 },
    contextLabel: { ...Typography.eyebrow(), color: theme.colors.accent.blue },
    contextTitle: { ...Typography.pageTitle(), color: theme.colors.text.primary },
    contextDetail: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    reply: { gap: 16 },
    replyIdentity: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 7 },
    replyName: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    composerArea: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
    fixtureControls: { alignSelf: 'center', width: '100%', maxWidth: 760, paddingHorizontal: 20, paddingBottom: 8 },
    fixtureOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    fixtureChoice: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
    fixtureNote: { ...Typography.rowMeta(), color: theme.colors.text.tertiary, marginTop: 8 },
}));
