import React from 'react';
import { useAuth } from '@/auth/context/AuthContext';
import { TokenStorage, isLegacyAuthCredentials } from '@/auth/storage/tokenStorage';
import { getCachedReadyServerFeatures, getReadyServerFeatures } from '@/sync/api/capabilities/getReadyServerFeatures';
import { Modal } from '@/modal';
import { t } from '@/text';
import { SecretKeyBackupModal } from '@/components/account/SecretKeyBackupModal';
import { fireAndForget } from '@/utils/system/fireAndForget';

function isRecoveryKeyReminderEnabled(features: ReturnType<typeof getCachedReadyServerFeatures>): boolean | null {
    if (!features) return null;
    return features.features?.auth?.ui?.recoveryKeyReminder?.enabled === true;
}

export function useRecoveryKeyReminder() {
    const auth = useAuth();

    const [dismissed, setDismissed] = React.useState<boolean | null>(() => TokenStorage.getCachedRecoveryKeyReminderDismissed());
    const [enabled, setEnabled] = React.useState<boolean | null>(() => isRecoveryKeyReminderEnabled(getCachedReadyServerFeatures()));

    React.useEffect(() => {
        let mounted = true;
        fireAndForget((async () => {
            const [isDismissed, features] = await Promise.all([
                TokenStorage.getRecoveryKeyReminderDismissed().catch(() => true),
                getReadyServerFeatures().catch(() => null),
            ]);

            const featureEnabled = isRecoveryKeyReminderEnabled(features);
            if (!mounted) return;
            setDismissed(isDismissed);
            setEnabled(featureEnabled);
        })(), { tag: 'useRecoveryKeyReminder.loadState' });
        return () => {
            mounted = false;
        };
    }, []);

    const secret = auth.isAuthenticated && auth.credentials && isLegacyAuthCredentials(auth.credentials)
        ? auth.credentials.secret : null;
    const visible = Boolean(secret) && dismissed === false && enabled === true;
    const openBackup = () => {
        if (!secret) return;
        Modal.show({ component: SecretKeyBackupModal, props: { secret } });
    };
    const dismiss = async () => {
        try {
            const saved = await TokenStorage.setRecoveryKeyReminderDismissed(true);
            if (!saved) throw new Error("Recovery reminder dismissal was not persisted");
            setDismissed(true);
        } catch {
            Modal.alert(t('common.error'), t('errors.unknownError'), [{ text: t('common.ok') }]);
        }
    };
    return { visible, openBackup, dismiss };
}
