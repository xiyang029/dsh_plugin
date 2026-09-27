/**
 * 聚合 bundle `dsh-plugin-pack` 的 Host 入口。
 *
 * 一个安装包携带多个独立功能。每个功能都是 `features/<name>/host.js` 下的
 * 自包含 Cordis 插件，有自己的 `apply` 和自己的 Service `inject` 列表；本文件
 * 只是分发点，把它们逐个挂载到同一个 Host 上下文上。
 *
 * 由于 Cordis 插件用 `inject` 声明 Host Service 依赖，一个 bundle 挂载多个
 * 功能时必须声明所有功能依赖的并集 —— 被禁用功能用不到的 Service 只是
 * 永远不会被解析，不会成为任何东西的硬依赖。
 *
 * 新增一个功能只需在 `FEATURES` 数组里加一项：不用在 `cordis.patch.yml`
 * 里加新行，也不需要安装第二个 bundle。
 */
import { apply as applyDeleteSession } from './features/delete-session/host.js';
import { apply as applyPromptInjection } from './features/prompt-injection/host.js';

/** 下面这些功能所需的 Host Service 的并集。 */
export const inject = ['commands', 'systemPrompt', 'webServer'];

/** 本 bundle 提供的功能列表，按挂载顺序排列。 */
export const FEATURES = [
  { name: 'delete-session', title: '删除会话', enabled: true, apply: applyDeleteSession },
  { name: 'prompt-injection', title: '提示词注入', enabled: true, apply: applyPromptInjection },
];

/**
 * 把每个已启用的功能挂载到这个 Host 上下文上。
 *
 * 各功能在自己 `apply` 内部调用的 `ctx.effect` 才是它注册的所有者，所以
 * 直接调用 `apply` 就足以让它的注册随 bundle 一起被正确销毁。这里故意
 * 不捕获异常：抛错的功能必须以 Loader 中一行失败的 bundle 记录暴露出来，
 * 而不是被静默吞掉。
 */
export function apply(ctx, config = {}) {
  for (const feature of FEATURES) {
    if (feature.enabled === false) continue;
    const featureConfig = config?.[feature.name] ?? {};
    feature.apply(ctx, featureConfig);
  }
}
