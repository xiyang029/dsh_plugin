# dsh_plugin — DSH 插件合集（monorepo）

本仓库包含两个**相互独立**的 dsh 插件包，放在同一个 git 仓库里维护，但各自
拥有独立的包名、版本号、组件行与生命周期——在 dsh 插件页里是两个独立插件，
**可以分别停用/启用，且停用即前后端（Host 命令/服务 + Client UI）一起下线**。

| 包 | 目录 | 功能 | 插件页显示 |
| --- | --- | --- | --- |
| `dsh-plugin-delete-session` | [`packages/delete-session`](packages/delete-session) | 侧边栏一键永久删除会话（行悬浮按钮、下拉菜单项、二次确认弹窗） | 删除会话 |
| `dsh-plugin-prompt-injection` | [`packages/prompt-injection`](packages/prompt-injection) | 编辑一段自定义指令，持久化后注入到每一轮请求的系统提示词 | 提示词注入 |

## 1. 为什么是"两个包"而不是"一个聚合包"

dsh 的 Client 收录机制有一条硬约束：**只有根包名行会进 Client boot graph**，
且一个包只允许一个 Client bundle 源（`dsh-client-modules` 对"同一包被多个
活动 Loader 行引用"直接抛错）。聚合包结构（一根行 + N 个功能子路径行）里，
插件页停用某个功能行只会摘除 Host 半边，Client UI 由根行统一加载、无法跟随
下线。

要"每个功能的前后端独立开关"，每个功能必须拥有自己的根行 = 自己的包。
本仓库因此采用 monorepo：一次 `git clone` / 一条安装命令获得两个插件，
但每个插件都是标准的"一根行一包"结构。

## 2. 安装（一条命令，两个插件）

从 GitHub 安装（`#path:` 指向仓库内的包目录，pnpm 原生支持）：

```powershell
dsh plugin --profile desktop add `
  github:xiyang029/dsh_plugin#path:packages/delete-session `
  github:xiyang029/dsh_plugin#path:packages/prompt-injection
```

从本地目录安装（开发调试，同样一条命令）：

```powershell
dsh plugin --profile desktop add `
  E:\python\dsh_plugin\packages\delete-session `
  E:\python\dsh_plugin\packages\prompt-injection
```

安装后重启（或让 profile 热加载）即可生效。每个包的 `package.json` 都声明了
`dsh.bundle.patch` 指向自带的 `cordis.patch.yml`，不需要手动编辑 profile 的
patch 文件。

安装、升级、停用、卸载都按**单个包**进行：

```powershell
dsh plugin --profile desktop remove dsh-plugin-delete-session     # 只卸载删除会话
dsh plugin --profile desktop remove dsh-plugin-prompt-injection   # 只卸载提示词注入
```

> 从旧版聚合包（`dsh-plugin-pack`）升级：先卸载旧包再安装两个新包。
> 两个新包的数据与旧包完全兼容——提示词注入沿用同一个存储文件，
> 删除会话不产生数据。

## 3. 每个包的内部结构

两个包结构完全一致（以 `delete-session` 为例）：

```
packages/delete-session/
├── package.json         # dsh.bundle.patch（Host 接线）+ dsh.client（Client 接线）
├── cordis.patch.yml     # 一行 insert：id = 包名的根行
├── index.js             # Host：apply/inject，注册命令或服务
├── client.js            # Client 根模块：注册 id = 包名，挂载 UI
├── atomic-write.js      # 包私有的零依赖原子文件替换
└── locales/{en,zh}.json # 插件页元数据文案
```

- **Host 侧**（`index.js`）导出 `name`（cordis 插件名）、`inject`（所需
  Service）与 `apply(ctx, config)`，注册随 `ctx.effect` 的生命周期销毁。
- **Client 侧**（`client.js`）按 boot row id（= 包名）注册根模块，声明
  `inject`（所需 Client Service）并在 `apply(ctx)` 里注册 locale 与 slots。
- 插件页停用该包 → 收录扫描跳过这一行 → Host 不加载、Client bundle 不进
  boot graph，**前后端一起下线**。

## 4. 功能细节

### 删除会话（dsh-plugin-delete-session）

- Host：注册 `/delete-session <sessionId>` 命令——删除会话工件目录、从
  工作区注册表注销、清扫投影缓存行（原子写保护 `workspace.json`），并广播
  `api-session/removed` 让侧边栏同步移除该行。
- Client：会话行悬浮垃圾桶按钮 + 「...」菜单项，点击弹出确认弹窗，确认后
  执行命令并反复刷新列表直到该行真正消失。

### 提示词注入（dsh-plugin-prompt-injection）

- Host：把保存的文本注册为 `systemPrompt` section（`order: -90`，排在部署
  人格之前），并提供 `GET/POST /api/prompt-injection` 读写接口。接口带完整
  防护：`connection` 服务的信任围栏（Host/Origin + 浏览器认证）、content-type
  校验、64KB 请求体上限、原子写持久化。
- Client：侧边栏面板列表新增"提示词注入"入口，编辑弹窗支持保存、取消、
  恢复默认。该功能的界面文案在所有语言下均为中文——它本身的作用就是把
  助手引导到中文。

## 5. 数据位置

| 数据 | 位置 |
| --- | --- |
| 提示词注入的文本 | `$DSH_HOME/prompt-injection/prompt-injection.json`（删除该文件即恢复默认指令） |
| 删除会话 | 不产生自己的数据；它删除的是 `$DSH_HOME/sessions/` 下的会话工件 |

## 6. 开发说明

- 两个包均为纯 ESM JavaScript，**无构建步骤**：仓库内源码即运行代码。
- 修改某个包后重启对应运行时（或触发热加载）即可看到效果；本地调试用
  `dsh plugin --profile desktop add <包目录>` 指向仓库内的包目录即可。
- 修改 Client UI 只改对应包的 `client.js`（唯一实现）。
- 新增第三个插件：在 `packages/` 下新建同构目录（package.json /
  cordis.patch.yml / index.js / client.js / locales），并在本 README 的
  包表格中登记。

## 7. 许可证

本仓库基于 [MIT License](./LICENSE) 发布。

Copyright (c) 2026 xiyang029
