import React from 'react';
import { Stack } from 'expo-router';
import { NativeSessionPublishScreen } from '@/components/sessions/sharing/NativeSessionPublishScreen';
import { t } from '@/text';

export default function NativeSessionPublishRoute() {
    return <><Stack.Screen options={{ title: t('nativeSessionSharing.title') }} /><NativeSessionPublishScreen /></>;
}
