import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** Read-only status refresh: no provisioning or message sends; stops offscreen or backgrounded. */
export function useSharedEntryPolling(refresh: () => Promise<unknown>, enabled: boolean) {
    const focused = useIsFocused();
    useEffect(() => {
        if (!enabled || !focused) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const visible = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
            && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
        const schedule = () => {
            if (timer) clearTimeout(timer);
            if (stopped || !visible()) return;
            timer = setTimeout(async () => {
                if (stopped || !visible()) return;
                await refresh();
                schedule();
            }, 3_000);
        };
        const subscription = AppState.addEventListener('change', schedule);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', schedule);
        schedule();
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            subscription.remove();
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', schedule);
        };
    }, [enabled, focused, refresh]);
}
