import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import * as Clipboard from 'expo-clipboard';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { t } from '@/text';
import { createSharedEntryClient, SharedEntryError, type SharedEntry, type SharedEntryMember } from '@/sync/api/social/apiSharedEntries';
import { getActiveServerSnapshot, getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { sharedEntryErrorMessage } from './sharedEntryPresentation';

const clipboardWriteFailure = new Error('Clipboard write failed');

const stylesheet = StyleSheet.create((theme) => ({
    introduction: {
        padding: theme.margins.lg,
        gap: theme.margins.md,
    },
    name: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    detail: {
        color: theme.colors.text.secondary,
    },
    actions: {
        gap: theme.margins.md,
    },
}));

type SharedEntryManagementProps = {
    sourceSessionId: string; machineId: string; title: string; serverId: string | null;
};

export function SharedEntryManagement(props: SharedEntryManagementProps) {
    // Reset invitations and members before a different source or relay can render them.
    return <SharedEntryManagementScope key={JSON.stringify([props.serverId, props.sourceSessionId, props.machineId])} {...props} />;
}

function SharedEntryManagementScope({ sourceSessionId, machineId, title, serverId }: SharedEntryManagementProps) {
    const client = useMemo(() => createSharedEntryClient(serverId), [serverId]);
    const [entries, setEntries] = useState<SharedEntry[]>([]);
    const [entry, setEntry] = useState<SharedEntry | null>(null);
    const selectedEntryId = useRef<string | null>(null);
    const [members, setMembers] = useState<SharedEntryMember[]>([]);
    const [inviteToken, setInviteToken] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [copied, setCopied] = useState(false);
    const [managementExpanded, setManagementExpanded] = useState(false);
    const inFlight = useRef(false);
    const generation = useRef(0);
    const mounted = useRef(false);
    const run = useCallback(async (operation: (isCurrent: () => boolean) => Promise<void>) => {
        if (!mounted.current || inFlight.current) return;
        const currentGeneration = generation.current;
        const isCurrent = () => mounted.current && generation.current === currentGeneration;
        inFlight.current = true; setBusy(true); setError(null);
        try { await operation(isCurrent); } catch (nextError) { if (isCurrent()) setError(nextError); }
        finally { if (isCurrent()) { inFlight.current = false; setBusy(false); } }
    }, []);
    const readReusableInvite = useCallback(async (next: SharedEntry | null): Promise<string | null> => {
        if (!next?.hasReusableInvite) return null;
        try { return await client.getInvite(next.id); }
        catch (error) {
            // A known lost/obsolete secret can only be repaired by explicit rotation.
            // Transient failures retain the existing error-and-refresh path.
            if (error instanceof SharedEntryError && error.status === 409 && error.code === 'invite_secret_unavailable') return null;
            throw error;
        }
    }, [client]);
    const load = useCallback(async (isCurrent: () => boolean) => {
        const nextEntries = (await client.list()).filter(item => item.sourceSessionId === sourceSessionId);
        if (!isCurrent()) return;
        const next = nextEntries.find(item => item.id === selectedEntryId.current) ?? nextEntries[0] ?? null;
        const nextMembers = next ? await client.members(next.id) : [];
        if (!isCurrent()) return;
        const reusableToken = await readReusableInvite(next);
        if (!isCurrent()) return;
        if (next?.hasReusableInvite || next?.id !== selectedEntryId.current) { setInviteToken(reusableToken); setCopied(false); }
        selectedEntryId.current = next?.id ?? null;
        if (reusableToken) setInviteToken(reusableToken);
        setEntries(nextEntries); setEntry(next); setMembers(nextMembers); setLoaded(true);
    }, [client, readReusableInvite, sourceSessionId]);
    useEffect(() => {
        mounted.current = true;
        generation.current += 1; inFlight.current = false;
        void run(load);
        return () => { mounted.current = false; generation.current += 1; };
    }, [load, run]);
    const create = async () => run(async (isCurrent) => {
        const name = await Modal.prompt(t('sharedEntry.name'), t(entry ? 'sharedEntry.createFreshDetail' : 'sharedEntry.description'), {
            defaultValue: title, confirmText: t(entry ? 'sharedEntry.createFresh' : 'sharedEntry.create'), cancelText: t('common.cancel'),
        });
        if (!isCurrent() || !name?.trim()) return;
        const created = await client.create({ title: name.trim(), sourceSessionId, machineId });
        if (!isCurrent()) return;
        selectedEntryId.current = created.entry.id;
        setEntries(previous => [created.entry, ...previous.filter(item => item.id !== created.entry.id)]);
        setEntry(created.entry); setMembers([]); setInviteToken(created.inviteToken); setCopied(false);
    });
    const selectEntry = (next: SharedEntry) => run(async (isCurrent) => {
        if (next.id === selectedEntryId.current) return;
        const nextMembers = await client.members(next.id);
        if (!isCurrent()) return;
        const reusableToken = await readReusableInvite(next);
        if (!isCurrent()) return;
        selectedEntryId.current = next.id;
        setEntry(next); setMembers(nextMembers); setInviteToken(reusableToken); setCopied(false);
    });
    const rotate = () => run(async (isCurrent) => {
        const confirmed = await Modal.confirm(t('sharedEntry.rotate'), t('sharedEntry.rotateDetail'), {
            confirmText: t('sharedEntry.rotate'), cancelText: t('common.cancel'),
        });
        if (!isCurrent() || !confirmed || !entry) return;
        const token = await client.rotateInvite(entry.id);
        if (!isCurrent()) return;
        setInviteToken(token); setCopied(false);
    });
    const copy = async () => {
        if (!inviteToken) return;
        const snapshot = getActiveServerSnapshot();
        const profile = serverId ? getServerProfileById(serverId) : null;
        const relay = profile?.shareableServerUrl || profile?.serverUrl || snapshot.activeShareableServerUrl || snapshot.serverUrl;
        const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin
            : (process.env.EXPO_PUBLIC_HAPPY_WEBAPP_URL || 'https://app.happier.dev').replace(/\/+$/, '');
        await run(async (isCurrent) => {
            setCopied(false);
            const didCopy = await Clipboard.setStringAsync(`${origin}/invite/${encodeURIComponent(inviteToken)}?server=${encodeURIComponent(relay)}`).catch(() => false);
            if (!didCopy) throw clipboardWriteFailure;
            if (isCurrent()) setCopied(true);
        });
    };
    const styles = stylesheet;
    return <>
        <ItemGroup title={t('sharedEntry.generateStep')}>
            <View style={styles.introduction}>
                <Text style={styles.name}>{entry?.title ?? title}</Text>
                <Text style={styles.detail}>{t('sharedEntry.contextDetail')}</Text>
                {loaded ? <View style={styles.actions}>
                    {!entry ? <RoundButton testID="shared-entry-create" title={t('sharedEntry.create')} accessibilityLabel={t('sharedEntry.create')}
                        size="normal" disabled={busy || !machineId} onPress={() => void create()} /> : !entry.hasContextSnapshot ?
                        <RoundButton testID="shared-entry-create-fresh" title={t('sharedEntry.createFresh')} accessibilityLabel={t('sharedEntry.createFresh')}
                            size="normal" disabled={busy || !machineId} onPress={() => void create()} /> : inviteToken ? <>
                        <RoundButton testID="shared-entry-copy" title={copied ? t('sharedEntry.copied') : t('sharedEntry.copy')}
                            accessibilityLabel={copied ? t('sharedEntry.copied') : t('sharedEntry.copy')}
                            size="normal" disabled={busy} onPress={() => void copy()} />
                        <Text testID="shared-entry-link-next-step" style={styles.detail} accessibilityLiveRegion="polite">
                            {t(copied ? 'sharedEntry.copiedDetail' : 'sharedEntry.sendLinkDetail')}
                        </Text>
                    </> : <>
                        <Text testID="shared-entry-link-unavailable" style={styles.detail}>{t('sharedEntry.linkUnavailable')}</Text>
                        <RoundButton testID="shared-entry-rotate" title={t('sharedEntry.rotate')} accessibilityLabel={t('sharedEntry.rotate')}
                            size="normal" disabled={busy} onPress={() => void rotate()} />
                    </>}
                </View> : null}
            </View>
            {!loaded && busy ? <Item title={t('common.loading')} showChevron={false} /> : null}
            {entry && !entry.hasContextSnapshot ? <Item testID="shared-entry-snapshot-missing" title={t('sharedEntry.snapshotMissing')} showChevron={false} /> : null}
            {error ? <Item testID="shared-entry-management-error" title={error === clipboardWriteFailure ? t('sharedEntry.copyFailed') : sharedEntryErrorMessage(error)} showChevron={false} /> : null}
            <Item testID="shared-entry-members-refresh" title={t('sharedEntry.refresh')} disabled={busy} onPress={() => void run(load)} />
        </ItemGroup>
        {entry ? <ItemGroup>
            <Item testID="shared-entry-management-toggle" title={t(managementExpanded ? 'sharedEntry.hideManagement' : 'sharedEntry.manageInvitations')}
                accessibilityState={{ expanded: managementExpanded }} disabled={busy} onPress={() => setManagementExpanded(previous => !previous)} />
            {managementExpanded && entry.hasContextSnapshot ? <>
                {inviteToken ? <Item testID="shared-entry-rotate" title={t('sharedEntry.rotate')} subtitle={t('sharedEntry.rotateDetail')}
                    disabled={busy} onPress={() => void rotate()} /> : null}
                <Item testID="shared-entry-create-fresh" title={t('sharedEntry.createFresh')} subtitle={t('sharedEntry.createFreshDetail')}
                    disabled={busy || !machineId} onPress={() => void create()} />
            </> : null}
        </ItemGroup> : null}
        {managementExpanded && entries.length > 1 ? <ItemGroup title={t('sharedEntry.previousInvitations')}>
            {entries.map(item => <Item key={item.id} testID={`shared-entry-select-${item.id}`} title={item.title}
                subtitle={new Date(item.createdAt).toLocaleString()} selected={item.id === entry?.id} showChevron={false}
                disabled={busy} onPress={() => void selectEntry(item)} />)}
        </ItemGroup> : null}
        {entry ? <ItemGroup title={t('sharedEntry.members')}>
            {members.length === 0 ? <Item title={t('sharedEntry.noMembers')} showChevron={false} /> : members.map(member => <Item
                key={member.id} testID={`shared-entry-member-${member.id}`} title={member.username || member.userId}
                subtitle={`${t(member.enabled ? 'sharedEntry.canUse' : 'sharedEntry.disabled')} · ${t(member.enabled ? 'sharedEntry.disable' : 'sharedEntry.enable')}${member.enabled && ['pending', 'provisioning'].includes(member.status) ? ` · ${t('sharedEntry.preparing')}` : member.status === 'failed' ? ` · ${member.errorCode?.startsWith('context_snapshot_') ? sharedEntryErrorMessage(new SharedEntryError(member.errorCode, 409)) : t('sharedEntry.preparationFailed')}` : ''}`}
                disabled={busy} onPress={() => void run(async (isCurrent) => {
                    const updated = await client.setMemberEnabled(entry.id, member.id, !member.enabled);
                    if (!isCurrent()) return;
                    setMembers(previous => previous.map(item => item.id === updated.id ? updated : item));
                })} />)}
        </ItemGroup> : null}
    </>;
}
