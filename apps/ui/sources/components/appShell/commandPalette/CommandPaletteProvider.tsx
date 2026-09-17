import React, { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Modal } from '@/modal';
import { CommandPalette } from './CommandPalette';
import { Command } from './types';
import { useAuth } from '@/auth/context/AuthContext';
import { storage } from '@/sync/domains/state/storage';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { buildCommandPaletteCommands } from './buildCommandPaletteCommands';
import { KeyboardShortcutProvider, buildKeyboardShortcutLabels, resolveKeyboardPlatform } from '@/keyboard';
import { useResolveNewSessionOrdinaryEntryRoute } from '@/components/sessions/new/navigation/newSessionOrdinaryEntryRoute';

const EMPTY_KEYBOARD_HANDLERS = {};
const EMPTY_ENABLED_WHEN_DISABLED_COMMAND_IDS: readonly [] = [];

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    if (Platform.OS !== 'web') {
        return (
            <KeyboardShortcutProvider
                handlers={EMPTY_KEYBOARD_HANDLERS}
                enabledWhenDisabledCommandIds={EMPTY_ENABLED_WHEN_DISABLED_COMMAND_IDS}
            >
                {children}
            </KeyboardShortcutProvider>
        );
    }

    return <WebCommandPaletteProvider>{children}</WebCommandPaletteProvider>;
}

function WebCommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const resolveNewSessionOrdinaryEntryRoute = useResolveNewSessionOrdinaryEntryRoute();
    const { logout } = useAuth();
    const {
        commandPaletteEnabled,
        keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutDisabledCommandIdsV1,
        keyboardShortcutOverridesV1,
    } = storage(useShallow((state) => ({
        commandPaletteEnabled: state.settings.commandPaletteEnabled,
        keyboardSingleKeyShortcutsEnabled: state.settings.keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutDisabledCommandIdsV1: state.settings.keyboardShortcutDisabledCommandIdsV1,
        keyboardShortcutOverridesV1: state.settings.keyboardShortcutOverridesV1,
    })));
    const navigateToSession = useNavigateToSession();
    const keyboardPlatform = useMemo(resolveKeyboardPlatform, []);
    const shortcutLabels = useMemo(
        () => buildKeyboardShortcutLabels(keyboardPlatform, Platform.OS === 'web' ? 'web' : 'native', {
            disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
            overrides: keyboardShortcutOverridesV1 ?? {},
            singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
            handlers: {
                'session.new': () => undefined,
                'settings.open': () => undefined,
            },
            context: {
                isEditableTarget: false,
                isComposing: false,
            },
        }),
        [
            keyboardPlatform,
            keyboardShortcutDisabledCommandIdsV1,
            keyboardShortcutOverridesV1,
            keyboardSingleKeyShortcutsEnabled,
        ],
    );
    const openNewSession = useCallback(() => {
        const { draftId, draftOrigin } = resolveNewSessionOrdinaryEntryRoute();
        router.push({ pathname: '/new', params: { draftId, draftOrigin } });
    }, [resolveNewSessionOrdinaryEntryRoute, router]);

    const buildCommands = useCallback((): Command[] => {
        const sessions = storage.getState().sessions;

        return buildCommandPaletteCommands({
            sessionsById: sessions as any,
            shortcutLabels,
            nav: {
                push: (path) => router.push(path as any),
                openNewSession,
                navigateToSession,
            },
            auth: { logout },
        });
    }, [shortcutLabels, router, openNewSession, navigateToSession, logout]);

    const showCommandPalette = useCallback(() => {
        if (Platform.OS !== 'web' || !commandPaletteEnabled) return;

        Modal.show({
            component: CommandPalette,
            props: {
                commands: buildCommands(),
            }
        });
    }, [buildCommands, commandPaletteEnabled]);

    const keyboardHandlers = useMemo(() => ({
        ...(commandPaletteEnabled ? { 'commandPalette.open': showCommandPalette } : {}),
        'session.new': openNewSession,
        'settings.open': () => {
            router.push('/settings' as any);
        },
    }), [commandPaletteEnabled, openNewSession, router, showCommandPalette]);
    const keyboardEnabledWhenDisabledCommandIds = useMemo(
        () => commandPaletteEnabled ? ['commandPalette.open'] as const : [],
        [commandPaletteEnabled],
    );

    return (
        <KeyboardShortcutProvider
            handlers={keyboardHandlers}
            enabledWhenDisabledCommandIds={keyboardEnabledWhenDisabledCommandIds}
        >
            {children}
        </KeyboardShortcutProvider>
    );
}
