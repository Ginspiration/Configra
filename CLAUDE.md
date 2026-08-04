# CLAUDE.md

本项目（Configra / 配表匠）的 Claude Code 会话入口。项目级产品语义、开发约束、源码结构和验证命令以 `AGENTS.md` 为准；本文件只补充 Claude Code 的使用约定。

## 首要规则

- 会话开始时先读 `AGENTS.md`，遵循其中关于游戏配置编辑器、稳定 ID、引用语义、校验、导出和 MCP 工作流的约束。
- 始终把本仓库当作“游戏配置编辑工具”，不要扩展成通用 Excel 替代品。
- 代码注释、Configra 表/字段备注和用户可见文案优先使用简体中文；标识符、API 名、路径、生成内容和第三方注释保持原样。
- 不要覆盖用户已有的无关修改，不要使用破坏性 Git 回滚命令。
- 添加新的可见 UI 文案时，先更新 `src/i18n.ts` 的 `en`，再更新 `zh`，组件中使用现有翻译入口。

## MCP 服务器

根目录 `.mcp.json` 挂载本项目的本机 MCP：

- `configra`（`http://127.0.0.1:37631/mcp`）：由源码桌面应用在“设置 -> AI / MCP”中启动，用于检查、预览 patch、应用 patch、校验和导出当前已保存并打开的工程。

MCP 工具描述、输入 schema 和返回结果是实时权威契约；不要从 `AGENTS.md` 或 `README.md` 复制旧 schema 来猜参数。

MCP 工具缺失或连接失败时：先确认桌面应用已通过 `npm run tauri:dev` 运行，并且设置中的本机 MCP 已开启；然后在 Claude Code 中使用 `/mcp` 或 `claude mcp reconnect configra` 重连，最多重试两次。不要停止、杀掉或重启 Configra、Node.js、Tauri 或 MCP 服务进程。

## 技能

- `configra-project`：涉及修改 Configra 工程文件、配置表、字段、行数据、引用关系、导出数据或 MCP/CLI 契约时使用。

## 开发验证

- 普通代码修改后运行 `npm run build`。
- 修改测试覆盖的纯逻辑时运行 `npm run test` 或相关 Vitest 文件。
- 修改 Tauri、桌面文件行为或 MCP 生命周期时，额外运行：

```bash
cd src-tauri
cargo check
```

- 修改 UI 行为时，启动 `npm run dev` 或 `npm run tauri:dev` 做本地交互验证。

已知 Vite/Rollup 的 Glide Data Grid `/*#__PURE__*/` 注释警告和主 chunk 大小警告当前不阻塞构建。
