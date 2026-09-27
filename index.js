/**
 * 聚合 bundle `dsh-plugin-pack` 的根行（Client bundle 载体行）。
 *
 * 为什么存在一个"什么都不做"的根行
 * --------------------------------
 * Client bundle 的收录只认**根包名行**：dsh-client-modules 的激活扫描
 * （lib/index.js 的 `exactPackageSpecifier`）对带子路径的行名（如
 * `dsh-plugin-pack/delete-session`）返回 undefined，`resolveMeta` 因此
 * 返回 null，这样的行不会进入 boot graph —— 包的 `client.js` 就永远不会
 * 被页面加载。官方 `dsh-plugin-desktop` 家族也是同样的结构：根行
 * `dsh-plugin-desktop` 承载 Client bundle，`dsh-plugin-desktop/terminal`
 * 等子路径行承载各自的 Host 功能。
 *
 * 因此本行的职责是：让 `dsh-plugin-pack` 作为一个激活的 Loader 行存在，
 * 从而让 Client 根模块（client.js + 两个 chunk）被收录进页面；Host 功能
 * 全部由 `plugin-pack-delete-session` 与 `plugin-pack-prompt-injection`
 * 两个子路径组件行承担（见 cordis.patch.yml）。本行绝不挂载任何功能，
 * 否则会与两个子路径行重复注册命令与路由。
 *
 * 唯一的真实功能开关在 Client 侧：client.js 里的 `ENABLED` 映射。
 */

/** 刻意留空：见文件头说明。功能在两个子路径组件行上。 */
export function apply() {}
