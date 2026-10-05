import * as React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { PressableSurface } from '@/components/ui/interaction/PressableSurface';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { UnauthenticatedSplitShell } from '@/components/onboarding/unauthShell/UnauthenticatedSplitShell';
import { RemoteWelcomeDecisionPanel } from '@/components/account/auth/RemoteWelcomeDecisionPanel';
import { deriveRemoteAuthEntryOptions } from '@/components/account/auth/useRemoteAuthEntryOptions';
import { SharedEntryInviteSurface, type SharedEntryInviteStatus } from '@/components/sessions/sharing/SharedEntryInviteSurface';
import { ChatHeaderView } from '@/components/sessions/transcript/ChatHeaderView';
import { AgentContentView } from '@/components/sessions/transcript/AgentContentView';
import { MessageView } from '@/components/sessions/transcript/MessageView';
import { AgentInput } from '@/components/sessions/agentInput';
import { useDemoMessages } from '@/hooks/session/useDemoMessages';
import { storage } from '@/sync/domains/state/storage';
import type { Message } from '@/sync/domains/messages/messageTypes';

// Representative content, never credentials, network fixtures or real user data.
const QA_EPOCH = Date.UTC(2026, 9, 5, 9);
const TITLE = '为共享工作区整理首页与邀请体验';
const LONG_TITLE = '为共享工作区整理首页与邀请体验：比较首次访问、回访、离线恢复、审批与长消息，并确保桌面和窄屏保持清晰的布局、真实交互与独立对话上下文。'.repeat(3);
const DESCRIPTION = '一起完善 COMBO 的共享项目体验。你可以接着这段上下文与 Codex 对话，检查实现并提出修改。';
const noop = () => {};
const syntheticSuggestions = async () => [];
type Surface = 'home' | 'invite' | 'conversation';
const states = ['normal', 'returning', 'long', 'offline', 'running', 'approval', 'failure'] as const;
type Scenario = typeof states[number];

const BASE_MESSAGES: Message[] = [
    { id: 'qa-user', localId: null, createdAt: QA_EPOCH + 1000, kind: 'user-text', text: '请先梳理邀请页的信息顺序，再检查手机上的输入体验。' },
    { id: 'qa-agent', localId: null, createdAt: QA_EPOCH + 2000, kind: 'agent-text', text: '我会先确认你将加入的项目，再展示分享者和协作用途。\n\n需要保留的行为：\n- 继承已有对话上下文，后续对话独立。\n- 共用项目文件，避免把对话误解为群聊。\n- 主机离线时明确拒绝请求，不排队等待。' },
    { id: 'qa-tool', localId: null, createdAt: QA_EPOCH + 3000, kind: 'tool-call', tool: { name: 'Read', state: 'completed', input: { file_path: '/synthetic-workspace/DESIGN.md' }, createdAt: QA_EPOCH + 3000, startedAt: QA_EPOCH + 3000, completedAt: QA_EPOCH + 4000, description: '检查既有设计规范', result: '采用项目既有的语义主题、文字层级和布局组件。' }, children: [] },
    { id: 'qa-summary', localId: null, createdAt: QA_EPOCH + 5000, kind: 'agent-text', text: '已确认这次需要调整整屏结构。正文保持稳定的阅读列；工具活动作为次级信息；输入区留在当前视口下方，审批和离线原因靠近操作。\n\n你希望接下来先检查哪一个状态？' },
];

function SyntheticConversation({ scenario, onBack, draft, setDraft }: { scenario: Scenario; onBack: () => void; draft: string; setDraft: (value: string) => void }) {
    const { theme } = useUnistyles();
    const [sent, setSent] = React.useState<Message[]>([]);
    const [showTitle, setShowTitle] = React.useState(false);
    const messages = React.useMemo(() => {
        const tool = BASE_MESSAGES[2] as Extract<Message, { kind: 'tool-call' }>;
        const toolState = scenario === 'running' ? 'running' : scenario === 'failure' ? 'error' : 'completed';
        return [...BASE_MESSAGES.slice(0, 2), { ...tool, tool: { ...tool.tool, state: toolState, result: toolState === 'error' ? '合成测试：无法读取文件，请重试。' : tool.tool.result } } as Message, ...BASE_MESSAGES.slice(3), ...sent];
    }, [scenario, sent]);
    const sessionId = useDemoMessages(messages);
    const title = scenario === 'long' ? LONG_TITLE : TITLE;
    const send = React.useCallback(() => {
        if (!draft.trim() || scenario === 'offline') return;
        setSent(current => [...current, { id: `qa-sent-${current.length}`, kind: 'user-text', localId: null, createdAt: QA_EPOCH + 6000 + current.length, text: draft }]);
        setDraft('');
    }, [draft, scenario]);
    return <View style={styles.session}>
        <ChatHeaderView title={title} subtitle="/synthetic-workspace/combo" onBackPress={onBack}
            rightElement={<PressableSurface accessibilityLabel={t('sessionInfo.title')} onPress={() => setShowTitle(v => !v)} style={styles.control}><Text style={styles.label}>{t('sessionInfo.title')}</Text></PressableSurface>} />
        {showTitle ? <View style={styles.notice}><Text selectable style={styles.body}>{title}</Text></View> : null}
        <AgentContentView safeAreaBottom={0}
            content={<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.messages}>
                {messages.map(message => <MessageView key={message.id} message={message} sessionId={sessionId} metadata={null} getMessageById={id => messages.find(m => m.id === id) ?? null} />)}
            </ScrollView>}
            input={<View>
                {scenario === 'offline' ? <View style={styles.notice}><Text accessibilityLiveRegion="polite" style={styles.body}>{t('welcome.frontDoorHostRequirement')}</Text></View> : null}
                <AgentInput sessionId={sessionId} value={draft} onChangeText={setDraft} placeholder={t('session.inputPlaceholder')}
                    onSend={send} autocompleteKinds={[]} autocompleteSuggestions={syntheticSuggestions} isSendDisabled={scenario === 'offline'} agentType="codex" sessionActive
                    onAbort={scenario === 'running' ? noop : undefined}
                    showAbortButton={scenario === 'running'}
                    permissionRequests={scenario === 'approval' ? [{ id: 'synthetic-approval', kind: 'permission', tool: 'Bash', arguments: { command: 'yarn test' }, createdAt: QA_EPOCH + 3000 }] : undefined}
                    canApprovePermissions={false} permissionDisabledReason="readOnly"
                    connectionStatus={{ text: scenario === 'offline' ? t('status.offline') : scenario === 'running' ? t('common.loading') : 'Codex · 合成测试', color: theme.colors.text.secondary, dotColor: scenario === 'offline' ? theme.colors.state.warning.foreground : theme.colors.state.success.foreground }} />
            </View>} />
    </View>;
}

export function ComboDesignPreview() {
    const params = useLocalSearchParams<{ surface?: string; state?: string }>();
    const [surface, setSurface] = React.useState<Surface>(params.surface === 'invite' || params.surface === 'conversation' ? params.surface : 'home');
    const [scenario, setScenario] = React.useState<Scenario>(states.includes(params.state as Scenario) ? params.state as Scenario : 'normal');
    const { width } = useWindowDimensions();
    const [feedback, setFeedback] = React.useState('');
    const [draft, setDraft] = React.useState('');
    const [heroSeen, setHeroSeen] = React.useState(false);
    const before = React.useRef(storage.getState().localSettings);
    React.useLayoutEffect(() => {
        storage.setState({ localSettings: { ...storage.getState().localSettings, hasCompletedAuthOnce: scenario === 'returning', brandHeroSeenAt: scenario === 'returning' || heroSeen ? 1 : null } });
    }, [scenario, heroSeen]);
    React.useEffect(() => () => { storage.setState({ localSettings: { ...storage.getState().localSettings, hasCompletedAuthOnce: before.current.hasCompletedAuthOnce, brandHeroSeenAt: before.current.brandHeroSeenAt } }); }, []);
    const options = deriveRemoteAuthEntryOptions({ serverAvailability: scenario === 'offline' ? 'unavailable' : 'ready', serverUrlForCopy: 'http://synthetic-relay.invalid', retryServerCheck: () => setScenario('normal'), signupOptions: { anonymousEnabled: true, providerIds: [], preferredProviderId: null }, loginOptions: { mtlsEnabled: false, keylessProviderIds: [], preferredKeylessProviderId: null }, hasPendingSetupIntent: false, hasPendingTerminalConnect: false });
    const status: SharedEntryInviteStatus | null = scenario === 'offline'
        ? { testID: 'shared-entry-preparing', title: t('sharedEntry.preparing'), detail: t('sharedEntry.inviteHostOfflineWaiting') }
        : scenario === 'failure' ? { testID: 'shared-entry-error', title: t('sharedEntry.preparationFailed') }
        : scenario === 'running' ? { testID: 'shared-entry-preparing', title: t('sharedEntry.preparing'), detail: t('sharedEntry.preparingDetail'), loading: true } : null;
    const go = (next: Surface) => { setFeedback(''); setSurface(next); };
    return <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.qaBar}>
            <Text style={styles.qaLabel}>合成测试数据 · 所有操作仅限本地预览</Text>
            <ScrollView horizontal contentContainerStyle={styles.controls}>
                {(['home', 'invite', 'conversation'] as const).map(value => <PressableSurface key={value} accessibilityLabel={value} accessibilityState={{ selected: surface === value }} style={styles.control} onPress={() => go(value)}><Text style={styles.label}>{value}</Text></PressableSurface>)}
                {states.map(value => <PressableSurface key={value} accessibilityLabel={value} accessibilityState={{ selected: scenario === value }} style={styles.control} onPress={() => setScenario(value)}><Text style={styles.label}>{value}</Text></PressableSurface>)}
            </ScrollView>
            {feedback ? <Text accessibilityLiveRegion="polite" style={styles.label}>{feedback}</Text> : null}
        </View>
        {surface === 'home' ? <UnauthenticatedSplitShell stepId="welcome" isWelcomeStep allowMobileBrandHero onBrandHeroGetStarted={() => setHeroSeen(true)} onOpenRelayCustomFlow={() => setFeedback('合成测试：Relay 配置入口。')}>
            <RemoteWelcomeDecisionPanel options={options} layout="portrait" isDesktopShell={width > 720} onRestore={() => setFeedback('合成测试：恢复入口。')} onAnonymousSignup={() => setFeedback('合成测试：创建账号入口，不创建真实用户。')} onOpenSetup={noop} onProviderSignup={noop} onMtlsLogin={noop} onKeylessProviderLogin={noop} onChangeRelay={() => setScenario('normal')} />
        </UnauthenticatedSplitShell> : surface === 'invite' ? <SharedEntryInviteSurface
            title={scenario === 'long' ? LONG_TITLE : TITLE} publisher="林安 · 合成测试分享者" description={DESCRIPTION} showExplanation status={status}
            action={{ title: scenario === 'failure' ? t('common.retry') : t('sharedEntry.signIn'), onPress: () => go('conversation'), disabled: scenario === 'offline' || scenario === 'running' }} busy={false} onExit={() => go('home')} />
            : <SyntheticConversation scenario={scenario} onBack={() => go('invite')} draft={draft} setDraft={setDraft} />}
    </View>;
}

const styles = StyleSheet.create(theme => ({
    root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface.base },
    session: { flex: 1, minHeight: 0 },
    qaBar: { paddingHorizontal: theme.margins.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.default, backgroundColor: theme.colors.surface.inset },
    qaLabel: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    controls: { gap: theme.margins.xs },
    control: { minHeight: 44, paddingHorizontal: theme.margins.sm, justifyContent: 'center', borderRadius: theme.borderRadius.md },
    label: { ...Typography.rowMeta(), color: theme.colors.text.primary },
    body: { ...Typography.bodyText(), color: theme.colors.text.secondary },
    messages: { paddingTop: theme.margins.xxl, paddingBottom: theme.margins.lg, gap: theme.margins.sm },
    notice: { paddingHorizontal: theme.margins.xl, paddingVertical: theme.margins.sm },
}));
