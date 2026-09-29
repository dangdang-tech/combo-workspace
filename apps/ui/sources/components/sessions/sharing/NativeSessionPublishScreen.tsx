import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet } from 'react-native-unistyles';
import type { DirectSessionPublishPreviewResponse, DirectSessionPublishResponse } from '@happier-dev/protocol';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';

import { useAuth } from '@/auth/context/AuthContext';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useAllMachines } from '@/sync/domains/state/storage';
import { getActiveServerSnapshot, subscribeActiveServer } from '@/sync/domains/server/serverRuntime';
import { machineDirectSessionPublish, machineDirectSessionPublishPreview } from '@/sync/ops/machineDirectSessions';
import { readRpcErrorCode } from '@/sync/runtime/rpcErrors';
import { t } from '@/text';
import { SessionGettingStartedGuidanceView } from '../guidance/SessionGettingStartedGuidance';
import { DirectBrowseCandidatesList } from '../directSessions/browse/DirectBrowseCandidatesList';
import { useDirectBrowseCandidates, type DirectBrowseCandidate } from '../directSessions/browse/useDirectBrowseCandidates';

const CODEX_SOURCE = { kind: 'codexHome', home: 'user' } as const;
type ReadyPreview = Extract<DirectSessionPublishPreviewResponse, { status: 'ready' }>;
type Publication = Extract<DirectSessionPublishResponse, { ok: true }>['publication'];

const stylesheet = StyleSheet.create((theme) => ({
    container: { flex: 1 },
    steps: { flexDirection: 'row', alignItems: 'flex-start', padding: theme.margins.md },
    step: { flex: 1, alignItems: 'center', gap: theme.margins.sm },
    stepCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border.default, alignItems: 'center', justifyContent: 'center' },
    stepActive: { backgroundColor: theme.colors.button.primary.background, borderColor: theme.colors.button.primary.background },
    stepNumber: { ...Typography.rowMeta(), color: theme.colors.text.secondary },
    stepNumberActive: { color: theme.colors.button.primary.tint },
    stepLabel: { ...Typography.rowMeta(), color: theme.colors.text.secondary, textAlign: 'center' },
    stepLabelActive: { color: theme.colors.text.primary, fontWeight: '600' },
    stepConnector: { height: 1, flex: 0.25, marginTop: 14, backgroundColor: theme.colors.border.default },
    content: { padding: theme.margins.lg, gap: theme.margins.md },
    title: { ...Typography.rowTitle(), color: theme.colors.text.primary },
    detail: { ...Typography.body(), color: theme.colors.text.secondary },
    text: { ...Typography.body(), color: theme.colors.text.primary },
    field: { gap: theme.margins.sm },
    input: {
        ...Typography.body(), color: theme.colors.text.primary, backgroundColor: theme.colors.surface.inset,
        borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border.default,
        paddingHorizontal: theme.margins.md, paddingVertical: theme.margins.md,
    },
    inputFocused: { borderColor: theme.colors.focus.ring },
    message: { gap: theme.margins.sm, padding: theme.margins.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.default },
}));

function NativePublishSteps({ current }: { current: 1 | 2 | 3 }) {
    const labels = [t('nativeSessionSharing.stepChoose'), t('nativeSessionSharing.stepReview'), t('nativeSessionSharing.stepShare')];
    return <ItemGroup><View style={stylesheet.steps}>
        {labels.map((label, index) => <React.Fragment key={index}>
            {index > 0 ? <View style={stylesheet.stepConnector} /> : null}
            <View testID={`native-publish-step-${index + 1}`} accessible accessibilityRole="text"
                accessibilityLabel={`${index + 1}. ${label}${current === index + 1 ? ` · ${t('nativeSessionSharing.currentStep')}` : ''}`}
                {...(Platform.OS === 'web' ? { 'aria-current': current === index + 1 ? 'step' as const : undefined } : {})} style={stylesheet.step}>
                <View style={[stylesheet.stepCircle, index + 1 <= current ? stylesheet.stepActive : null]}>
                    <Text style={[stylesheet.stepNumber, index + 1 <= current ? stylesheet.stepNumberActive : null]}>{index + 1 < current ? '✓' : index + 1}</Text>
                </View>
                <Text style={[stylesheet.stepLabel, current === index + 1 ? stylesheet.stepLabelActive : null]}>{label}</Text>
            </View>
        </React.Fragment>)}
    </View></ItemGroup>;
}

function errorMessage(code: string | null, phase: 'load' | 'preview' | 'publish') {
    if (code === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE || code === RPC_ERROR_CODES.METHOD_NOT_FOUND) return t('nativeSessionSharing.hostUpdateRequired');
    if (code === 'machine_offline') return t('nativeSessionSharing.offline');
    if (code === 'snapshot_changed') return t('nativeSessionSharing.snapshotChanged');
    if (code === 'publication_capture_conflict') return t('nativeSessionSharing.captureConflict');
    if (code === 'context_snapshot_too_large') return t('nativeSessionSharing.contextTooLarge');
    if (code === 'context_snapshot_unavailable') return t('nativeSessionSharing.emptyPreview');
    if (code === 'not_authenticated') return t('nativeSessionSharing.signInRequired');
    return t(phase === 'load' ? 'nativeSessionSharing.loadFailed' : phase === 'preview' ? 'nativeSessionSharing.previewFailed' : 'nativeSessionSharing.publishFailed');
}

export function NativeSessionPublishScreen() {
    const auth = useAuth();
    const server = useSyncExternalStore(subscribeActiveServer, getActiveServerSnapshot, getActiveServerSnapshot);
    // Account and relay changes must dispose both the selected source and any pending private results.
    const key = JSON.stringify([auth.credentials?.token, server.serverId, server.serverUrl, server.generation]);
    if (!auth.isAuthenticated) return <ItemList><ItemGroup><Item title={t('nativeSessionSharing.signInRequired')} showChevron={false} /></ItemGroup></ItemList>;
    return <MachineSelection key={key} serverId={server.serverId} serverUrl={server.serverUrl} />;
}

function MachineSelection({ serverId, serverUrl }: { serverId: string; serverUrl: string }) {
    const machines = useAllMachines();
    const [selectedId, setSelectedId] = useState<string | null>(() => (machines.find(machine => machine.active) ?? machines[0])?.id ?? null);
    const [showSetup, setShowSetup] = useState(false);
    const selected = machines.find(machine => machine.id === selectedId) ?? machines.find(machine => machine.active) ?? machines[0];
    // Keep the initially chosen computer stable through status changes. Only choose again if it disappears.
    useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id); }, [selected?.id, selectedId]);
    if (!selected && showSetup) return <View style={stylesheet.container}>
        <ItemGroup><Item testID="native-publish-setup-back" title={t('common.back')} onPress={() => setShowSetup(false)} /></ItemGroup>
        <SessionGettingStartedGuidanceView variant="primaryPane" model={{ kind: 'connect_machine', targetLabel: serverUrl,
            serverUrl, serverName: serverUrl, showServerSetup: true }} />
    </View>;
    return <ItemList keyboardAware keyboardShouldPersistTaps="handled">
        <ItemGroup>
            <Item title={t('nativeSessionSharing.chooseMachine')} subtitle={t('nativeSessionSharing.machineScope')} subtitleLines={0} showChevron={false} />
            {machines.map(machine => <Item key={machine.id} testID={`native-publish-machine-${machine.id}`}
                title={machine.metadata?.displayName || machine.metadata?.host || t('nativeSessionSharing.connectedComputer')}
                subtitle={t(machine.active ? 'status.online' : 'status.offline')}
                selected={machine.id === selected?.id} showChevron={false}
                onPress={() => setSelectedId(machine.id)} />)}
            {!selected ? <>
                <Item testID="native-publish-no-machines" title={t('nativeSessionSharing.noMachines')} showChevron={false} />
                <Item testID="native-publish-connect-machine" title={t('nativeSessionSharing.connectMachine')} onPress={() => setShowSetup(true)} />
            </> : !selected.active ? <Item testID="native-publish-offline" title={t('nativeSessionSharing.offline')} titleLines={0} showChevron={false} /> : null}
        </ItemGroup>
        {selected ? <NativeSessionPublishFlow key={selected.id} machineId={selected.id} serverId={serverId} online={selected.active} /> : <NativePublishSteps current={1} />}
    </ItemList>;
}

function NativeSessionPublishFlow({ machineId, serverId, online }: { machineId: string; serverId: string; online: boolean }) {
    const [candidate, setCandidate] = useState<DirectBrowseCandidate | null>(null);
    const [preview, setPreview] = useState<ReadyPreview | null>(null);
    const [publication, setPublication] = useState<Publication | null>(null);
    const [reused, setReused] = useState(false);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState<'preview' | 'publish' | 'copy' | null>(null);
    const [error, setError] = useState<{ code: string | null; phase: 'preview' | 'publish' | 'copy' } | null>(null);
    const mounted = useRef(false);
    const request = useRef(0);
    const inFlight = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current += 1; }; }, []);
    const chooseAnother = () => {
        request.current += 1; inFlight.current = false;
        setCandidate(null); setPreview(null); setPublication(null); setError(null); setBusy(null); setCopied(false); setReused(false);
    };
    const loadPreview = async (next: DirectBrowseCandidate) => {
        if (!online || inFlight.current) return;
        const generation = ++request.current;
        const isCurrent = () => mounted.current && request.current === generation;
        inFlight.current = true; setBusy('preview'); setCandidate(next); setPreview(null); setError(null);
        try {
            const result = await machineDirectSessionPublishPreview({ machineId, providerId: 'codex', source: CODEX_SOURCE, remoteSessionId: next.remoteSessionId }, { serverId });
            if (!isCurrent()) return;
            if (!result.ok) setError({ code: result.errorCode, phase: 'preview' });
            else if (result.status === 'already_published') { setPublication(result.publication); setReused(true); }
            else setPreview(result);
        } catch (failure) { if (isCurrent()) setError({ code: readRpcErrorCode(failure) ?? null, phase: 'preview' }); }
        finally { if (isCurrent()) { inFlight.current = false; setBusy(null); } }
    };
    const publish = async (title: string, description: string) => {
        if (!online || !candidate || !preview || inFlight.current) return;
        const generation = ++request.current;
        const isCurrent = () => mounted.current && request.current === generation;
        inFlight.current = true; setBusy('publish'); setError(null);
        try {
            const result = await machineDirectSessionPublish({ machineId, providerId: 'codex', source: CODEX_SOURCE, remoteSessionId: candidate.remoteSessionId,
                expectedSnapshotFingerprint: preview.snapshotFingerprint, title: title.trim(), description: description.trim() }, { serverId });
            if (!isCurrent()) return;
            if (!result.ok) {
                setError({ code: result.errorCode, phase: 'publish' });
                if (['snapshot_changed', 'publication_capture_conflict', 'context_snapshot_too_large', 'context_snapshot_unavailable'].includes(result.errorCode)) setPreview(null);
            } else setPublication(result.publication);
        } catch (failure) {
            if (!isCurrent()) return;
            // A lost response does not mean the host failed to commit the publication.
            // Reconcile through the read-only preview owner; never auto-submit it twice.
            try {
                const recovered = await machineDirectSessionPublishPreview({ machineId, providerId: 'codex', source: CODEX_SOURCE,
                    remoteSessionId: candidate.remoteSessionId }, { serverId });
                if (!isCurrent()) return;
                if (recovered.ok && recovered.status === 'already_published') {
                    setPublication(recovered.publication);
                    setReused(true);
                    return;
                }
            } catch { /* Keep the original failure if the host is still unreachable. */ }
            if (isCurrent()) setError({ code: readRpcErrorCode(failure) ?? null, phase: 'publish' });
        }
        finally { if (isCurrent()) { inFlight.current = false; setBusy(null); } }
    };
    const copy = async () => {
        if (!publication || inFlight.current) return;
        const generation = ++request.current;
        const isCurrent = () => mounted.current && request.current === generation;
        inFlight.current = true; setBusy('copy'); setCopied(false); setError(null);
        try {
            const written = await Clipboard.setStringAsync(publication.inviteUrl).catch(() => false);
            if (isCurrent()) { if (written) setCopied(true); else setError({ code: null, phase: 'copy' }); }
        } finally { if (isCurrent()) { inFlight.current = false; setBusy(null); } }
    };
    const terminalError = error && ['publication_capture_conflict', 'context_snapshot_too_large', 'not_authenticated'].includes(error.code ?? '');
    return <>
        <NativePublishSteps current={publication ? 3 : candidate ? 2 : 1} />
        {!candidate ? (online ? <NativeConversationPicker machineId={machineId} serverId={serverId} onSelect={loadPreview} /> : null) : <>
            <ItemGroup>
                <Item testID="native-publish-choose-another" title={candidate.title || t('nativeSessionSharing.untitledSession')} titleLines={2} subtitle={t('nativeSessionSharing.chooseAnother')} disabled={busy === 'publish' || busy === 'copy'} onPress={chooseAnother} />
            </ItemGroup>
            {busy === 'preview' ? <ItemGroup><Item title={t('common.loading')} showChevron={false} /></ItemGroup> : null}
            {publication ? <ItemGroup title={t('nativeSessionSharing.linkReady')}>
                {reused ? <Item testID="native-publish-reused" title={t('nativeSessionSharing.alreadyPublished')} titleLines={0} showChevron={false} /> : null}
                <View style={stylesheet.content}>
                    <Text style={stylesheet.detail}>{t('sharedEntry.sendLinkDetail')}</Text>
                    <TextInput testID="native-publish-link" value={publication.inviteUrl} editable={false} multiline accessibilityLabel={t('sharedEntry.copy')} style={stylesheet.input} />
                    <RoundButton testID="native-publish-copy" title={t(copied ? 'sharedEntry.copied' : 'sharedEntry.copy')} size="normal" loading={busy === 'copy'} onPress={() => void copy()} />
                    {copied ? <Text testID="native-publish-copied" accessibilityLiveRegion="polite" style={stylesheet.detail}>{t('sharedEntry.copiedDetail')}</Text> : null}
                </View>
            </ItemGroup> : <NativePublishReview key={candidate.remoteSessionId} candidate={candidate} preview={preview} busy={busy !== null} online={online} onPublish={publish} />}
            {error ? <ItemGroup><Item testID="native-publish-error" title={error.phase === 'copy' ? t('sharedEntry.copyFailed') : errorMessage(error.code, error.phase)} titleLines={0} showChevron={false} /></ItemGroup> : null}
            {error && !publication && !preview && !terminalError ? <ItemGroup><Item testID="native-publish-preview-retry" title={t('nativeSessionSharing.reviewAgain')} disabled={!online || busy !== null} onPress={() => void loadPreview(candidate)} /></ItemGroup> : null}
        </>}
    </>;
}

function NativeConversationPicker({ machineId, serverId, onSelect }: { machineId: string; serverId: string; onSelect: (candidate: DirectBrowseCandidate) => Promise<void> }) {
    const [query, setQuery] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    useEffect(() => { const timeout = setTimeout(() => setSearchTerm(query.trim()), 250); return () => clearTimeout(timeout); }, [query]);
    const browse = useDirectBrowseCandidates({ machineId, serverId, providerId: 'codex', source: CODEX_SOURCE, searchTerm });
    const select = useCallback((candidate: DirectBrowseCandidate) => { void onSelect(candidate); }, [onSelect]);
    return <>
        <DirectBrowseCandidatesList {...browse} groupByDirectory activityBadgeMode="running-only" error={browse.error ? errorMessage(browse.errorCode, 'load') : null}
            linkingSessionId={null} searchQuery={query} onSearchQueryChange={setQuery} onSelectCandidate={select} onLoadMore={browse.loadMore} />
        {browse.error ? <ItemGroup><Item testID="native-publish-list-retry" title={t('common.retry')} onPress={() => void browse.refresh()} /></ItemGroup> : null}
    </>;
}

function NativePublishReview({ candidate, preview, busy, online, onPublish }: { candidate: DirectBrowseCandidate; preview: ReadyPreview | null; busy: boolean; online: boolean; onPublish: (title: string, description: string) => Promise<void> }) {
    const [title, setTitle] = useState((candidate.title?.trim() || t('nativeSessionSharing.untitledSession')).slice(0, 120));
    const [description, setDescription] = useState('');
    const [focusedField, setFocusedField] = useState<'title' | 'description' | null>(null);
    return <>
        {preview ? <NativeTextPreview key={preview.snapshotFingerprint} preview={preview} /> : null}
        {preview ? <ItemGroup><View style={stylesheet.content}>
            <View style={stylesheet.field}>
                <Text style={stylesheet.title}>{t('sharedEntry.name')}</Text>
                <TextInput testID="native-publish-title" value={title} onChangeText={setTitle} maxLength={120} editable={!busy}
                    accessibilityLabel={t('sharedEntry.name')} onFocus={() => setFocusedField('title')} onBlur={() => setFocusedField(null)}
                    style={[stylesheet.input, focusedField === 'title' ? stylesheet.inputFocused : null]} />
            </View>
            <View style={stylesheet.field}>
                <Text style={stylesheet.title}>{t('nativeSessionSharing.purpose')}</Text>
                <TextInput testID="native-publish-description" value={description} onChangeText={setDescription} maxLength={1000} editable={!busy} multiline
                    accessibilityLabel={t('nativeSessionSharing.purpose')} placeholder={t('nativeSessionSharing.purposePlaceholder')}
                    onFocus={() => setFocusedField('description')} onBlur={() => setFocusedField(null)}
                    style={[stylesheet.input, focusedField === 'description' ? stylesheet.inputFocused : null]} />
            </View>
            {busy ? <Text testID="native-publish-wait-detail" accessibilityLiveRegion="polite" style={stylesheet.detail}>{t('nativeSessionSharing.generatingDetail')}</Text> : null}
            {preview ? <RoundButton testID="native-publish-generate" title={t(busy ? 'nativeSessionSharing.generating' : 'sharedEntry.create')} size="normal"
                disabled={!online || busy || !title.trim()} onPress={() => void onPublish(title, description)} /> : null}
        </View></ItemGroup> : null}
    </>;
}

function NativeTextPreview({ preview }: { preview: ReadyPreview }) {
    const [visibleCount, setVisibleCount] = useState(20);
    const [expanded, setExpanded] = useState(false);
    return <ItemGroup title={t('nativeSessionSharing.previewTitle')}>
        <View style={stylesheet.content}>
            <Text style={stylesheet.text}>{t('nativeSessionSharing.shareOutcome')}</Text>
            <Text style={stylesheet.detail}>{t('nativeSessionSharing.sharedExecution')}</Text>
        </View>
        <Item testID="native-publish-preview-toggle"
            title={expanded ? t('common.collapse') : t('nativeSessionSharing.previewCount', { count: preview.messages.length })}
            titleLines={0} accessibilityState={{ expanded }} showChevron={false}
            onPress={() => setExpanded(value => !value)} />
        {expanded ? <View style={stylesheet.content}><Text style={stylesheet.detail}>{t('nativeSessionSharing.previewDetail')}</Text></View> : null}
        {expanded ? preview.messages.slice(0, visibleCount).map((message, index) => <View key={index} style={stylesheet.message}>
            <Text style={stylesheet.title}>{t(message.role === 'user' ? 'nativeSessionSharing.user' : 'nativeSessionSharing.assistant')}</Text>
            <Text testID={`native-publish-preview-message-${index}`} selectable style={stylesheet.text}>{message.text}</Text>
        </View>) : null}
        {expanded && visibleCount < preview.messages.length ? <Item testID="native-publish-preview-more" title={t('directSessions.browseLoadMore')} onPress={() => setVisibleCount(count => count + 20)} /> : null}
    </ItemGroup>;
}
