import { describe, expect, it } from "vitest";
import { readServerEnabledBit } from "@happier-dev/protocol";
import { resolveServerFeaturesForGating } from "./catalog/serverFeatureGate";

describe("private session entry feature", () => {
    it("defaults closed and requires explicit server activation", () => {
        expect(readServerEnabledBit(resolveServerFeaturesForGating({}), "sharing.sessionEntries")).toBe(false);
        expect(readServerEnabledBit(resolveServerFeaturesForGating({
            HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED: "1",
        }), "sharing.sessionEntries")).toBe(true);
    });
    it("respects the canonical sharing dependency deny policy", () => {
        expect(readServerEnabledBit(resolveServerFeaturesForGating({
            HAPPIER_FEATURE_SHARING_SESSION_ENTRIES__ENABLED: "1",
            HAPPIER_BUILD_FEATURES_DENY: "sharing.session",
        }), "sharing.sessionEntries")).toBe(false);
    });
});
