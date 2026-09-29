import * as React from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/context/AuthContext';
import { Modal } from '@/modal';
import { t } from '@/text';

// Account settings and the global account menu share one confirmation and exit flow.
export function useAccountLogout() {
    const auth = useAuth();
    const router = useRouter();
    const pending = React.useRef(false);
    const [busy, setBusy] = React.useState(false);
    const logout = React.useCallback(async () => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
            const confirmed = await Modal.confirm(t('common.logout'), t('settingsAccount.logoutConfirm'), {
                confirmText: t('common.logout'), destructive: true,
            });
            if (!confirmed) return;
            await auth.logout();
            router.replace('/');
        } catch {
            Modal.alert(t('common.error'), t('errors.unknownError'));
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }, [auth.logout, router]);
    return { logout, busy };
}
