# dsh-plugin-pack — DSH 聚合插件包

## 1. 项目简介

`dsh-plugin-pack` 是一个**单包聚合插件**（方案 A）：把原本各自独立的两个插件仓库
`dsh-plugin-delete-message`（删除会话）与 `dsh-plugin-prompt-injection`（提示词注入）
合并进同一个仓库、同一个包中。

它只暴露**一个** bundle 行，安装一次即可获得全部功能：

- 只安装一个包，不再需要分别为两个插件执行安装命令；
- 只注册一个 Host 插件与**一个** Client 根模块（UI 按需从包内 chunk 加载），生命周期统一；
- 升级、卸载、开关都只需操作这一行。

| 项目 | 值 |
| --- | --- |
| 包名 | `dsh-plugin-pack` |
| 版本 | `1.0.0` |
| 可见性 | `private` |
| 模块类型 | `type: "module"`（ESM） |
| 仓库 | <https://github.com/xiyang029/dsh_plugin> |
| 许可证 | MIT |

## 2. 功能列表

### ① 删除会话（delete-session）

- 侧边栏会话行**悬浮按钮**：鼠标移入会话行时出现垃圾桶图标，位置与样式对齐宿主
  自带的归档／置顶按钮（16×16、无内边距、同样的 tooltip 位置与 500ms 延迟）。
- 会话行 **"..." 下拉菜单**中同样提供"删除会话"一项。
- 点击后弹出**确认弹窗**，需二次确认才执行。
- 确认后执行 Host 命令 `/delete-session <sessionId>`，**永久删除该会话及其存储记录**，
  不可撤销。

### ② 提示词注入（prompt-injection）

- 在**侧边栏面板列表**中新增一个入口（图标 + 中文标签"提示词注入"）。
- 打开后是一个编辑面板／弹窗，可编辑一段**自定义指令**。
- 保存后该文本被**持久化**，并注入到每一轮请求的系统提示词中。
- 提供"恢复默认"按钮，可一键还原为默认文本（默认指令的中文语义为"始终使用中文…"）。
- 该功能的界面文案在**所有语言环境下均为中文**：它本身的作用就是把助手引导到中文，
  因此 UI 不允许泄漏英文。

## 3. 安装

```powershell
dsh plugin --profile desktop add github:xiyang029/dsh_plugin
```

安装后重启（或让 profile 热加载）即可生效。包内已声明 `dsh.bundle.patch` 指向自带的
`cordis.patch.yml`，因此**不需要**手动编辑 profile 的 patch 文件。

## 4. 目录结构

```
dsh_plugin/
├── package.json
├── cordis.patch.yml
├── index.js                     # Host 聚合入口
├── client.js                    # Client 根模块（注册 id = 包名）
├── client.delete-session.js     # 包内 chunk：删除会话 UI
├── client.prompt-injection.js   # 包内 chunk：提示词注入 UI
├── locales/{en,zh}.json
├── features/
│   ├── delete-session/host.js
│   └── prompt-injection/host.js
└── README.md
```

各文件职责：

| 路径 | 职责 |
| --- | --- |
| `index.js` | Host 聚合入口：`FEATURES` 数组 + `apply`，把各 feature 的 Host 半边挂到同一个 ctx |
| `client.js` | Client **根模块**：注册 `id: 'dsh-plugin-pack'`，并在 `apply` 里按需拉取两个 chunk |
| `client.<name>.js` | 包内 **chunk**：该 feature 的 Client UI（唯一实现，运行时真正加载的就是它） |
| `features/<name>/host.js` | 单个功能的 Host 实现（自带 `apply` 与 `inject`，被 `index.js` import） |
| `locales/{en,zh}.json` | 包级元数据文案（标题／描述），与 feature 的 locale 命名空间相互独立 |
| `cordis.patch.yml` | bundle patch，只向 profile 插入一行 `dsh-plugin-pack` |

## 5. 工作原理

### Host 侧

`index.js` 是唯一的 Host 入口，它导出：

- `inject`：两个 feature 所需 Host Service 的**并集**（`commands`、`systemPrompt`、`webServer`）。
  因为 Cordis 插件用 `inject` 声明依赖，一个 bundle 挂多个 feature 时必须声明并集；
  被禁用的 feature 对应的 Service 只是永远不会被解析，不会成为任何东西的硬依赖。
- `FEATURES`：本 bundle 提供的 feature 列表，按挂载顺序排列。
- `apply(ctx, config)`：遍历 `FEATURES`，逐个调用该 feature 的 `apply`，
  并把 `config[feature.name]` 作为该 feature 的配置传下去。

每个 feature 的注册都由它自己 `apply` 内部的 `ctx.effect` 持有，因此直接调用 `apply`
即可让它的注册随 bundle 一起被正确销毁。`apply` **故意不捕获异常**：
某个 feature 抛错时会作为 Loader 中一行失败的 bundle 记录暴露出来，而不是被静默吞掉。

### Client 侧：根模块 + 两个 chunk

这里有一个**硬约束**：DSH 的 Client 模块加载器按 boot row id 校验注册结果，
而一行的 row id **就是包名**（该行的 bundle URL 形如 `<row.id>/client.js`）。
因此根模块**只能**注册 `id: 'dsh-plugin-pack'`；若注册 `dsh-plugin-pack#xxx` 之类的
id，`arrive()` 会判定"脚本加载了却没有注册该 id"并抛错，两个 UI 全部挂不上。

同一个包内的额外模块必须走 **chunk 机制**：注册时 `id` 仍等于包名，
用 `chunk` 字段区分，加载器内部以 `<包名>/<chunk文件名>` 作为键。

| 文件 | 注册的 id | 注册的 chunk |
| --- | --- | --- |
| `client.js` | `dsh-plugin-pack` | ——（根模块） |
| `client.delete-session.js` | `dsh-plugin-pack` | `client.delete-session.js` |
| `client.prompt-injection.js` | `dsh-plugin-pack` | `client.prompt-injection.js` |

chunk 文件名必须匹配 `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`。

**chunk 由谁加载？** 宿主**不会**自动加载 chunk。根模块的工厂函数拿到的 `require`
带有一个 `require.async` 方法，相对路径分支会切掉 `"./"`、校验文件名，再去拉取并注册
该 chunk。所以 `client.js` 的 `apply` 里显式拉取两个 chunk：

```js
async apply(ctx) {
  if (ENABLED['delete-session'] === true) {
    const deleteSession = await require.async('./client.delete-session.js');
    deleteSession.apply(ctx);
  }
  if (ENABLED['prompt-injection'] === true) {
    const promptInjection = await require.async('./client.prompt-injection.js');
    promptInjection.apply(ctx);
  }
}
```

chunk 是**被根模块消费的普通模块，不是独立的插件行**，因此它以**返回值**暴露导出
（加载器把工厂函数的返回值当作该模块的 exports）。本项目让每个 chunk 返回
`{ apply(ctx) }`，由上方的根模块把**根 ctx** 传进去。

于是 locale 注册与 slot 注册都发生在根 ctx 上，但各自使用**自己的命名空间**
（`edit-message` 与 `prompt-injection`）与各自不重叠的 slot 名，因此两个功能在
同一个页面里并存而不会冲突：

| chunk | locale 命名空间 | 注册的 slot |
| --- | --- | --- |
| `client.delete-session.js` | `edit-message` | `sidebar.workspaces.session.row.action`、`sidebar.workspaces.session.menu.item`、`shell.overlay` |
| `client.prompt-injection.js` | `prompt-injection` | `sidebar.panellist`、`main` |

> 维护约定：每个 feature 的 Client UI 只有一份实现，就是根目录的 `client.<name>.js`
> chunk。改 UI 只改这一处，不存在需要同步的镜像文件。

### bundle 接线

`cordis.patch.yml` 只做一件事：向 profile 的插件列表**插入一行** `dsh-plugin-pack`。
新增 feature 时**不需要**新增 patch 行、也不需要安装第二个 bundle——只需在
`index.js` 的 `FEATURES` 里加一项、在 `client.js` 的 `ENABLED` 里加一个键，
并新增一个 `client.<name>.js` chunk。

## 6. 开关与"不能单独卸载"的取舍

### 整包开关

本包注册为**一行 bundle**，所以在 profile 层面只能整包启用／禁用：

```powershell
dsh plugin --profile desktop remove dsh-plugin-pack   # 整包关闭
```

这是方案 A 的直接代价：**无法只卸载其中一个功能**，也无法让两个功能各自拥有独立的
版本号与升级节奏。换来的是"一次安装 = 全部功能"和单一生命周期。

### 只启用其中一个功能

包内部提供了按 feature 的细粒度开关，**两个入口各管一半**：

**(a) Host 侧 —— `index.js` 的 `FEATURES` 数组（源码实际字段）**

```js
export const FEATURES = [
  { name: 'delete-session',   title: '删除会话',   enabled: true, apply: applyDeleteSession },
  { name: 'prompt-injection', title: '提示词注入', enabled: true, apply: applyPromptInjection },
];
```

数组每项的字段为 `name` / `title` / `enabled` / `apply`：

- `enabled`：布尔字段。`apply` 中的判断为 `if (feature.enabled === false) continue;`，
  即只有**显式** `false` 才会跳过该 feature，`true` 或省略都会挂载。
- `name`：同时是 `config` 的取键名（`config?.[feature.name] ?? {}`），
  也是 `features/<name>/` 的目录名。
- `title`：人类可读名称，仅用于识别。
- `apply`：该 feature 的 Host 挂载函数。

因此"只想启用提示词注入"，把 `delete-session` 那项的 `enabled` 改为 `false` 即可。

**(b) Client 侧 —— `client.js` 工厂函数内的 `ENABLED` 映射**

注意：Client 侧的开关**不是** `FEATURES` 数组，而是一张按 feature 名索引的映射，
位于**根工厂函数内部**（不是文件顶层常量）：

```js
factory(require) {
  const ENABLED = { 'delete-session': true, 'prompt-injection': true };
  // ...
}
```

它在 `apply` 中决定是否拉取对应的 chunk：**跳过 `require.async` 即等于不加载该功能**，
其 locale 命名空间与 slot 都不会被注册。

同样地，只有**显式 `true`** 才会去拉取 chunk，另一个 feature 不受影响。

> **必须两侧同时改。** Host 与 Client 的开关是两份彼此独立的配置：只改一边会出现
> "Host 已挂载但 UI 不出现"（或反之）的半残状态。禁用某个功能时，
> 请同时修改 `index.js` 的 `FEATURES[i].enabled` 与 `client.js` 内的 `ENABLED[name]`。

### 与 feature 源码的关系

`features/<name>/host.js` 是 Host 侧真正被 `index.js` import 的实现，改它有效；
Client UI 则直接改根目录的 `client.<name>.js` chunk（唯一实现）。
`features/` 下只有 Host 代码，没有 Client 代码。

## 7. 数据位置

提示词注入的文本持久化在 DSH 用户目录下：

```
$DSH_HOME/prompt-injection/prompt-injection.json
```

- 该文件由 prompt-injection feature 的 Host 半边通过 HTTP 接口 `api/prompt-injection`
  读写（Client 侧用 `fetch(API, { method: 'GET' | 'POST' })`）。
- 文件不存在时接口返回默认文本；"恢复默认"按钮会把编辑器内容重置为该默认值。
- 删除该文件即可恢复到初始状态（不会影响会话数据）。

## 8. 开发与本地安装

仓库根目录即包根目录，无需构建步骤（源码直接作为 ESM 加载）。

方式一：从本地绝对路径安装 bundle

```
install_bundle F:\dsh_plugin
```

方式二：把本地目录加入某个 profile

```powershell
dsh plugin --profile desktop add F:\dsh_plugin
```

修改 `index.js` / `client.js` 后，重启对应运行时（或触发热加载）即可看到效果；
修改 Client UI 时直接编辑对应的 `client.<name>.js` chunk 即可。

## 9. 许可证

本项目基于 [MIT License](./LICENSE) 发布。

Copyright (c) 2026 xiyang029
