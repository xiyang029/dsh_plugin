/**
 * 聚合 bundle `dsh-plugin-pack` 的 Client 根模块。
 *
 * 为什么本文件只注册 `id: 'dsh-plugin-pack'`
 * ------------------------------------------
 * Client 模块系统按 boot row id 校验 bundle 的根注册：`arrive()` 读取
 * `const { id } = row`（client-modules/lib/client.js:611），只接受恰好注册了
 * 这个 id 的脚本（:624、:640）。而 boot row 的 id 就是包名（它的 bundle URL
 * 形如 `<row.id>/client.js`，:484），所以根注册的 id 必须等于包名。在这里
 * 注册 `'dsh-plugin-pack#<功能名>'` 会导致 arrive 失败：加载器报
 * "loaded without registering" 并抛错，所有 UI 都挂不上。
 *
 * 同一个包内的额外模块因此必须走 chunk 机制：`register()`（:570-572）在
 * 存在 `chunk` 字段时以 `<id>/<chunk>` 作为内部键，所以
 * `{ id: 'dsh-plugin-pack', chunk: 'client.x.js' }` 是官方支持的第二模块
 * 注册方式，不会破坏 arrive。
 *
 * chunk 如何被加载（已对照源码确认）
 * ----------------------------------
 * 宿主从不自动加载 chunk。`makeRequire`（:696-715）交给每个工厂的 `require`
 * 带有 `require.async`，其相对路径分支（:707-713）切掉 `"./"`、用 CLIENT_CHUNK
 * （:470）校验文件名，然后调用 `importChunk(ownerId, fileName)`（:716-742）。
 * 后者按 owner row 拼 URL（:480-486）并要求脚本注册内部键
 * `chunkId(ownerId, fileName)`（:718，:739 校验）。
 *
 * 因此每个 chunk 都是从这里、在 `apply` 内部用
 * `require.async('./client.<功能名>.js')` 拉取的 —— 与官方自带的
 * sidebar-terminal bundle 用法相同（ui-sidebar-terminal/lib/client.js:167：
 * `react.lazy(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }))`），
 * sidebar-documentpreview 同理（lib/client.js:4883）。由于 `materialize`
 * （:683）把 chunk 工厂的返回值作为该模块的 exports（`exports: registered.factory(...)`），
 * chunk 通过返回一个对象来暴露值，与官方 chunk 完全一致。
 *
 * 每个 chunk 因此返回 `{ apply }`，本文件用根 ctx 驱动它。locale 注册和
 * slot 注册都发生在根 ctx 上，但用的是各功能自己的命名空间
 * （'edit-message' 与 'prompt-injection'），两者在同一页面互不冲突。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-pack',
  factory(require) {
    /**
     * 包内按功能的开关。设为 `false` 就不拉取该功能的 chunk，它的 locale
     * 命名空间与 slot 都不会注册；另一个功能不受影响。整个 bundle 的
     * 开/关通过它唯一的 bundle 行控制 —— 包内没有按功能的安装单元。
     */
    const ENABLED = { 'delete-session': true, 'prompt-injection': true };

    return {
      /**
       * Client 半边需要的 Host Service。两个功能的需求以并集声明：
       * `sessions` 只有删除会话功能在用，用不到的 Service 不会成为
       * 任何东西的硬依赖。
       */
      inject: ['slots', 'sessions', 'locale'],
      async apply(ctx) {
        // 两个 chunk 都在这里（apply 内）拉取，这样在加载器查找
        // `dsh-plugin-pack/<chunk>` 键之前，各 chunk 的工厂已经注册完毕。
        if (ENABLED['delete-session'] === true) {
          const deleteSession = await require.async('./client.delete-session.js');
          deleteSession.apply(ctx);
        }
        if (ENABLED['prompt-injection'] === true) {
          const promptInjection = await require.async('./client.prompt-injection.js');
          promptInjection.apply(ctx);
        }
      },
    };
  },
});
