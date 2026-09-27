/**
 * Host entry of the aggregate bundle `dsh-plugin-pack`.
 *
 * One installed bundle carries several independent features. Each feature is a
 * self-contained Cordis plugin under `features/<name>/host.js` with its own
 * `apply` and its own service `inject` list; this file is only the fan-out
 * point that mounts them, one by one, onto the same Host context.
 *
 * Because a Cordis plugin declares its Host Service dependencies with `inject`,
 * one bundle mounting several features has to declare the union of what its
 * features need -- the unused Service of a disabled feature is simply never
 * resolved and never becomes a hard dependency of anything.
 *
 * Adding a feature is one entry in `FEATURES`: no extra row in
 * `cordis.patch.yml`, and no second bundle to install.
 */
import { apply as applyDeleteSession } from './features/delete-session/host.js';
import { apply as applyPromptInjection } from './features/prompt-injection/host.js';

/** Union of the Host Services the features below require. */
export const inject = ['commands', 'systemPrompt', 'webServer'];

/** The features this bundle ships, in mount order. */
export const FEATURES = [
  { name: 'delete-session', title: '删除会话', enabled: true, apply: applyDeleteSession },
  { name: 'prompt-injection', title: '提示词注入', enabled: true, apply: applyPromptInjection },
];

/**
 * Mount every enabled feature on this Host context.
 *
 * Each feature's own `ctx.effect` calls inside its `apply` are what own its
 * registrations, so calling `apply` directly is enough for them to be torn down
 * with the bundle. Exceptions are deliberately not caught: a feature that
 * throws must surface as a failed bundle row in the Loader rather than be
 * silently swallowed.
 */
export function apply(ctx, config = {}) {
  for (const feature of FEATURES) {
    if (feature.enabled === false) continue;
    const featureConfig = config?.[feature.name] ?? {};
    feature.apply(ctx, featureConfig);
  }
}
