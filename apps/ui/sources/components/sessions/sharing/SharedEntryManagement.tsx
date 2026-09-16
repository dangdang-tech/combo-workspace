import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { t } from '@/text';
import { createSharedEntryClient, type SharedEntry, type SharedEntryMember } from '@/sync/api/social/apiSharedEntries';
import { getActiveServerSnapshot, getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { sharedEntryErrorMessage } from './sharedEntryPresentation';

type SharedEntryManagementProps = {
    sourceSessionId: string; machineId: string; title: string; serverId: string | null;
};

export function SharedEntryManagement(props: SharedEntryManagementProps) {
    // Reset invitations and members before a different source or relay can render them.
    return <SharedEntryManagementScope key={JSON.stringify([props.serverId, props.sourceSessionId, props.machineId])} {...props} />;
}

function SharedEntryManagementScope({ sourceSessionId, machineId, title, serverId }: SharedEntryManagementProps) {
    const client = useMemo(() => createSharedEntryClient(serverId), [serverId]);
    const [entry, setEntry] = useState<SharedEntry | null>(null);
    const [members, setMembers] = useState<SharedEntryMember[]>([]);
    const [inviteToken, setInviteToken] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [copied, setCopied] = useState(false);
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
    const load = useCallback(async (isCurrent: () => boolean) => {
        const next = (await client.list()).find(item => item.sourceSessionId === sourceSessionId) ?? null;
        if (!isCurrent()) return;
        const nextMembers = next ? await client.members(next.id) : [];
        if (!isCurrent()) return;
        setEntry(next); setMembers(nextMembers); setLoaded(true);
    }, [client, sourceSessionId]);
    useEffect(() => {
        mounted.current = true;
        generation.current += 1; inFlight.current = false;
        void run(load);
        return () => { mounted.current = false; generation.current += 1; };
    }, [load, run]);
    const create = async () => run(async (isCurrent) => {
        const name = await Modal.prompt(t('sharedEntry.name'), t('sharedEntry.description'), {
            defaultValue: title, confirmText: t('sharedEntry.create'), cancelText: t('common.cancel'),
        });
        if (!isCurrent() || !name?.trim()) return;
        const created = await client.create({ title: name.trim(), sourceSessionId, machineId });
        if (!isCurrent()) return;
        setEntry(created.entry); setInviteToken(created.inviteToken); setCopied(false);
    });
    const copy = async () => {
        if (!inviteToken) return;
        const snapshot = getActiveServerSnapshot();
        const profile = serverId ? getServerProfileById(serverId) : null;
        const relay = profile?.shareableServerUrl || profile?.serverUrl || snapshot.activeShareableServerUrl || snapshot.serverUrl;
        const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin
            : (process.env.EXPO_PUBLIC_HAPPY_WEBAPP_URL || 'https://app.happier.dev').replace(/\/+$/, '');
        await run(async (isCurrent) => {
            await Clipboard.setStringAsync(`${origin}/invite/${encodeURIComponent(inviteToken)}?server=${encodeURIComponent(relay)}`);
            if (isCurrent()) setCopied(true);
        });
    };
    return <>
        <ItemGroup title={entry?.title ?? t('sharedEntry.title')} footer={t('sharedEntry.description')}>
            {!loaded && busy ? <Item title={t('common.loading')} showChevron={false} /> : null}
            {loaded && !entry ? <Item testID="shared-entry-create" title={t('sharedEntry.create')} disabled={busy || !machineId} onPress={() => void create()} /> : null}
            {entry ? <>
                {inviteToken ? <Item testID="shared-entry-copy" title={copied ? t('sharedEntry.copied') : t('sharedEntry.copy')} disabled={busy} onPress={() => void copy()} /> : null}
                <Item testID="shared-entry-rotate" title={t('sharedEntry.rotate')} subtitle={t('sharedEntry.rotateDetail')} disabled={busy} onPress={() => void run(async (isCurrent) => {
                    const token = await client.rotateInvite(entry.id);
                    if (!isCurrent()) return;
                    setInviteToken(token); setCopied(false);
                })} />
            </> : null}
            {error ? <Item testID="shared-entry-management-error" title={sharedEntryErrorMessage(error)} showChevron={false} /> : null}
            <Item testID="shared-entry-members-refresh" title={t('sharedEntry.refresh')} disabled={busy} onPress={() => void run(load)} />
        </ItemGroup>
        {entry ? <ItemGroup title={t('sharedEntry.members')}>
            {members.length === 0 ? <Item title={t('sharedEntry.noMembers')} showChevron={false} /> : members.map(member => <Item
                key={member.id} testID={`shared-entry-member-${member.id}`} title={member.username || member.userId}
                subtitle={`${t(member.enabled ? 'sharedEntry.canUse' : 'sharedEntry.disabled')} · ${t(member.enabled ? 'sharedEntry.disable' : 'sharedEntry.enable')}${member.enabled && ['pending', 'provisioning'].includes(member.status) ? ` · ${t('sharedEntry.preparing')}` : member.status === 'failed' ? ` · ${t('sharedEntry.preparationFailed')}` : ''}`}
                disabled={busy} onPress={() => void run(async (isCurrent) => {
                    const updated = await client.setMemberEnabled(entry.id, member.id, !member.enabled);
                    if (!isCurrent()) return;
                    setMembers(previous => previous.map(item => item.id === updated.id ? updated : item));
                })} />)}
        </ItemGroup> : null}
    </>;
}
