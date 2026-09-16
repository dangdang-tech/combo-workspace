import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SharedEntryInviteScreen } from '@/components/sessions/sharing/SharedEntryInviteScreen';
export default function InviteRoute() {
    const { token, server } = useLocalSearchParams<{ token?: string; server?: string }>();
    return <SharedEntryInviteScreen key={`${token}:${server}`} token={typeof token === 'string' ? token : ''} serverUrl={typeof server === 'string' ? server : undefined} />;
}
