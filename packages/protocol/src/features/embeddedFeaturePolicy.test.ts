import { describe, expect, it } from 'vitest';

import { evaluateFeatureBuildPolicy } from './buildPolicy.js';
import {
  mergeFeatureBuildPolicies,
  resolveEmbeddedFeatureBuildPolicy,
  resolveEmbeddedFeaturePolicyEnv,
  resolveFeatureBuildPolicyFromEnvOrEmbedded,
} from './embeddedFeaturePolicy.js';
import { FEATURE_IDS, getFeatureDependencies } from './catalog.js';

const workspaceFeatures = [
  'connectedServices', 'sharing.session', 'sharing.sessionEntries', 'sharing.contentKeys',
  'sharing.pendingQueueV2', 'sharing.pendingDeliveryState', 'sessions', 'sessions.drafts', 'machines',
  'auth.recovery.providerReset', 'auth.login.keyChallenge', 'auth.ui.recoveryKeyReminder',
  'auth.pairing.desktopQrMobileScan', 'app.ui.sessionGettingStartedGuidance',
] as const;

describe('embedded feature build policy', () => {
  it('does not treat development as preview', () => {
    expect(resolveEmbeddedFeaturePolicyEnv('development')).toBeNull();
    expect(resolveEmbeddedFeaturePolicyEnv('dev')).toBeNull();
  });

  it('defaults to neutral policy when no embedded policy env is configured', () => {
    const policy = resolveEmbeddedFeatureBuildPolicy(undefined);
    expect(policy.allow).toEqual([]);
    expect(policy.deny).toEqual([]);
  });

  it.each(['production', 'preview', undefined] as const)('ships only the sharing workspace, including without environment configuration: %s', (embeddedEnv) => {
    const policy = resolveFeatureBuildPolicyFromEnvOrEmbedded({ embeddedEnv });
    for (const id of FEATURE_IDS) {
      expect(evaluateFeatureBuildPolicy(policy, id), id).toBe(workspaceFeatures.some((feature) => feature === id) ? 'allow' : 'deny');
    }
    for (const id of workspaceFeatures) {
      for (const dependency of getFeatureDependencies(id)) {
        expect(evaluateFeatureBuildPolicy(policy, dependency), `${id} needs ${dependency}`).toBe('allow');
      }
    }
  });

  it('merges env policy by union and preserves deny precedence', () => {
    const base = resolveEmbeddedFeatureBuildPolicy('production');
    const merged = mergeFeatureBuildPolicies(base, { allow: ['voice'], deny: ['voice'] });
    expect(evaluateFeatureBuildPolicy(merged, 'voice')).toBe('deny');
  });
});
