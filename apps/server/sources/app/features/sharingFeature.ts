import type { FeaturesPayloadDelta } from "./types";
import { readSharingSessionEntriesFeatureEnv } from "./catalog/readFeatureEnv";

export function resolveSharingFeature(
    env: NodeJS.ProcessEnv = {},
): FeaturesPayloadDelta {
    return {
        features: {
            sharing: {
                session: { enabled: true },
                sessionEntries: { enabled: readSharingSessionEntriesFeatureEnv(env).enabled },
                public: { enabled: true },
                contentKeys: { enabled: true },
                pendingQueueV2: { enabled: true },
                pendingDeliveryState: { enabled: true },
                // PREPARE only. Activation follows once expected provider/mode and cross-row
                // correlation can be compared against a canonical indexed dispatch identity.
            },
        },
        capabilities: {
            sharing: {
                pendingQueueV2: {
                    deliveryState: true,
                    deliveryBlockedReason: true,
                },
            },
        },
    };
}
