import { parseIntEnv } from "@/config/env";

export interface PresenceTimeoutConfig {
    sessionTimeoutMs: number;
    machineTimeoutMs: number;
    tickMs: number;
}

const DEFAULT_PRESENCE_SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PRESENCE_MACHINE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PRESENCE_TIMEOUT_TICK_MS = 60 * 1000;

export function resolvePresenceTimeoutConfig(env: NodeJS.ProcessEnv = process.env): PresenceTimeoutConfig {
    return {
        sessionTimeoutMs: parseIntEnv(env.HAPPIER_PRESENCE_SESSION_TIMEOUT_MS, DEFAULT_PRESENCE_SESSION_TIMEOUT_MS, { min: 1 }),
        machineTimeoutMs: parseIntEnv(env.HAPPIER_PRESENCE_MACHINE_TIMEOUT_MS, DEFAULT_PRESENCE_MACHINE_TIMEOUT_MS, { min: 1 }),
        tickMs: parseIntEnv(env.HAPPIER_PRESENCE_TIMEOUT_TICK_MS, DEFAULT_PRESENCE_TIMEOUT_TICK_MS, { min: 1 }),
    };
}
