# Configra 开发交接文档

本文档用于交给后续 AI 或开发者继续接手本仓库。

当前仓库已经是一个独立的 Vite + React + TypeScript + Tauri 项目，不再是旧的 Godot 游戏项目。继续开发时，请始终把它当作“游戏配置编辑工具”，不要把它扩展成通用 Excel 替代品。

## 1. 产品目标

目标是做一个面向游戏配置数据的蓝图式表格编辑器。

核心闭环是：

```text
新建表
新建字段
编辑行数据
设置字段引用关系
用箭头可视化表关系
校验数据
导出每张表的 JSON
导出语言无关的 ID 注册表 JSON
保存/加载工程文件
```

这个工具不是 Excel。它应该继续围绕结构化游戏配置表、稳定内部 ID、引用关系、校验和导出展开。

当前没有内置生成式 AI，但源码桌面应用已经提供本机 MCP，供外部 AI 检查、修改、校验和导出当前已保存工程。AI 不直接修改 Zustand store；所有修改继续采用生成 patch、展示 diff、等待确认、应用 patch、重新校验的流程。

## 2. 当前实现概览

当前技术栈：

```text
Vite
React
TypeScript
React Flow
Zustand
Glide Data Grid
Tauri
```

当前界面结构：

```text
顶部工具栏：保存 / 加载 / 导出 / 设置
左侧面板：表列表
中间区域：React Flow 蓝图画布
编辑弹窗：表属性 + 字段 + 问题列表 + Glide Data Grid 行数据
右键菜单：表、画布、表格行/单元格操作
```

当前支持：

- Web 模式：`npm run dev`
- 桌面模式：`npm run tauri:dev`
- Headless CLI：`npm run --silent cfg -- ...`
- 源码桌面 MCP：设置 → AI / MCP

## 3. 逐项对照

本节按原始 MVP 目标逐项对照当前状态。

| 步骤 | 原始目标 | 当前状态 | 主要文件 |
| --- | --- | --- | --- |
| 1 | 创建 Vite + React + TypeScript 项目 | 已完成 | `package.json`, `vite.config.ts`, `src/main.tsx` |
| 2 | 安装 React Flow 和 Zustand | 已完成 | `package.json`, `src/graph/*`, `src/store/editorStore.ts` |
| 3 | 定义数据模型和示例工程 | 已完成，并扩展了 `identity` 和 `autoIncrement` | `src/model/types.ts`, `src/model/sampleProject.ts` |
| 4 | 实现 Zustand store | 已完成，包含脏状态、插入/批量删除行、自增行数据 | `src/store/editorStore.ts` |
| 5 | 实现基础布局 | 已完成，当前是工具栏 + 表列表 + 画布 + 编辑弹窗 | `src/App.tsx`, `src/styles/app.css` |
| 6 | 用 React Flow 渲染表节点 | 已完成 | `src/graph/GraphCanvas.tsx`, `src/graph/TableNode.tsx` |
| 7 | 拖动表节点并保存位置 | 已完成；拖动中和拖动结束都会更新位置 | `src/graph/GraphCanvas.tsx`, `src/store/editorStore.ts` |
| 8 | 根据 `ref` 字段生成箭头 | 已完成 | `src/graph/graphMapping.ts` |
| 9 | 选择表 | 已完成，支持表列表、节点点击和右键选中 | `src/App.tsx`, `src/graph/GraphCanvas.tsx` |
| 10 | 编辑表和字段 | 已完成，位于弹窗侧栏 | `src/inspector/TableInspector.tsx`, `src/inspector/ColumnEditor.tsx` |
| 11 | 编辑行数据 | 已完成，使用 Glide Data Grid 弹窗 | `src/dataGrid/DataGridModal.tsx` |
| 12 | 新增表、字段、行 | 已完成，支持快捷键、右键菜单、编辑按钮、空白表格行 | `src/App.tsx`, `src/store/editorStore.ts`, `src/dataGrid/DataGridModal.tsx` |
| 13 | 基础校验 | 已完成，并扩展了 ID 注册表校验 | `src/validation/validateProject.ts` |
| 14 | 导出当前表 JSON | 已完成，支持表右键和快捷键 | `src/App.tsx`, `src/export/exportTables.ts` |
| 15 | 保存/加载工程文件 | 已完成，支持浏览器和桌面模式 | `src/App.tsx`, `src/file/projectFile.ts`, `src/file/desktopProjectFile.ts`, `src-tauri/src/lib.rs` |
| 16 | 简单美化 UI | 已完成，当前是紧凑编辑器风格 | `src/styles/app.css` |
| 17 | 语言选择器 | 已完成，默认中文 | `src/i18n.ts`, `src/App.tsx` |
| 18 | 小地图可隐藏 | 已完成 | `src/App.tsx`, `src/graph/GraphCanvas.tsx` |
| 19 | 快捷键 | 已完成 | `src/App.tsx` |
| 20 | 桌面端最近工程和关闭前保存提示 | 已完成 | `src/App.tsx`, `src/file/desktopProjectFile.ts`, `src-tauri/src/lib.rs` |
| 21 | 用 ID 注册表连接代码和配置 | 已完成 | `src/model/types.ts`, `src/inspector/TableInspector.tsx`, `src/export/exportTables.ts`, `src/validation/validateProject.ts` |
| 22 | Headless CLI、两阶段 patch 和事务回滚 | 已完成 | `src/cli/cfg.ts`, `src/patch/dataPatch.ts`, `schemas/data-patch.schema.json` |
| 23 | 本机 MCP 和外部 AI 安全工作流 | 已完成，包含 scoped dirty、Full Access、日志和导出 | `src/mcp/server.ts`, `src/mcp/protocol.ts`, `src-tauri/src/lib.rs` |
| 24 | MCP 自解释 `ref` 关系与专用预览工具 | 已完成 | `src/model/referenceSemantics.ts`, `src/mcp/server.ts`, `src/cli/cfg.ts` |

## 4. 当前界面行为

### 顶部工具栏

顶部工具栏包含：

- 保存。
- 加载。
- 导出。
- 设置入口。设置面板按“界面”和“AI / MCP”分类，后续可继续扩展更多分类。

默认语言是中文，可切换为英文。

### 左侧表列表

表列表行为：

- 点击表项会选中表。
- 双击表项会打开行数据编辑弹窗。
- 右键表项会打开与画布表节点相同的表操作菜单。

### 画布

React Flow 画布行为：

- 表节点展示表名和字段列表。
- 表节点展示 `PK`、`AI`、必填标记和 `ref` 目标。
- 拖动表节点会更新表位置。
- 双击表节点会打开编辑弹窗。
- 右键表节点会打开表操作菜单。
- 右键画布空白处会打开画布/工程操作菜单。
- 小地图可以显示或隐藏。

### 右键菜单

表右键菜单：

- 编辑。
- 复制表 JSON。
- 下载 JSON。
- 删除表。

画布右键菜单：

- 在此新建表。
- 保存。
- 加载。
- 复制 ID 注册表。
- 下载 ID 注册表。
- 切换小地图。

表格右键菜单：

- 上方插入行。
- 下方插入行。
- 追加到末尾。
- 全部大写。
- 复制当前行或选中行 JSON。
- 删除当前行或选中行。

除输入框、文本框、下拉框和可编辑控件外，原生浏览器右键菜单会被禁止。

## 5. 行数据编辑器细节

行数据编辑器位于 `src/dataGrid/DataGridModal.tsx`，底层使用 Glide Data Grid。

重要行为：

- 编辑器以弹窗打开。
- 表属性、ID 注册表、字段和问题列表都集成在弹窗侧栏中。
- 支持全屏模式。
- 关闭按钮是 `X`。
- 搜索使用 Glide 内置搜索，并会定位到匹配单元格。
- 单元格双击后进入编辑。
- `editOnType` 已关闭。
- 行标记使用可点击数字。
- 支持多行和多矩形选择。
- 支持填充柄。
- 支持平滑滚动。
- 如果主键字段是第一列，会冻结该列。
- 已有行下方会显示额外空白行；编辑空白行会创建新行。
- 每张表的列宽会保存到 `localStorage`。

单元格行为：

- `bool` 映射为 Glide 布尔单元格。
- `int` 和 `float` 映射为数字单元格。
- `enum` 和 `ref` 映射为自定义下拉单元格。
- `json` 使用类似 Markdown 的文本单元格，导出时会尽量解析合法 JSON。
- 存在校验错误的单元格会通过 theme override 高亮。

粘贴行为：

- 普通矩形粘贴会从目标单元格开始应用。
- 单列文本如果包含换行或空行，会拆成多行；每行使用去除首尾空白后的非空文本。
- 粘贴超过已有行数时会自动创建行。
- 粘贴值会按字段类型解析。

全部大写行为：

- 只处理 `string` 单元格。
- 如果右键点在选区内，会把选区内所有字符串单元格转成大写。
- 如果右键点在选中行内，会把这些行里的所有字符串单元格转成大写。
- 否则只处理右键点中的字符串单元格。
- 没有可处理的字符串单元格时，菜单项会禁用。

## 6. 数据模型

当前模型定义在 `src/model/types.ts`。

```ts
export const COLUMN_TYPES = ['int', 'float', 'string', 'bool', 'enum', 'ref', 'json'] as const;

export type ProjectFile = {
  version: 1;
  tables: ConfigTable[];
};

export type ConfigTable = {
  id: string;
  name: string;
  remark?: string;
  position: GraphPosition;
  columns: ConfigColumn[];
  rows: ConfigRow[];
  identity?: TableIdentity;
};

export type TableIdentity = {
  namespace?: string;
  keyColumnId?: string;
  valueColumnId?: string;
};

export type ConfigColumn = {
  id: string;
  name: string;
  type: ColumnType;
  required?: boolean;
  primary?: boolean;
  autoIncrement?: boolean;
  export?: boolean;
  remark?: string;
  enumValues?: string[];
  ref?: ColumnRef;
};

export type ConfigRow = {
  _rowId: string;
  values: Record<string, unknown>;
};
```

重要规则：

- `table.id` 是内部稳定 ID。
- `column.id` 是内部稳定 ID。
- 字段重命名只改 `column.name`，不改 `column.id`。
- 行数据通过 `column.id` 存取。
- `_rowId` 是编辑器内部元数据，不参与导出。
- 表 JSON 导出使用 `column.name || column.id` 作为 key。

## 7. ID 注册表

ID 注册表用于把代码可读的符号名和运行时配置 ID 连接起来，同时避免生成某种特定语言的常量文件。

示例表：

```text
key             id      path
SOUND_CLICK      1      res://audio/click.wav
SOUND_WIN        2      res://audio/win.wav
```

表 identity：

```json
{
  "namespace": "Sound",
  "keyColumnId": "key",
  "valueColumnId": "id"
}
```

导出的 `config_ids.json`：

```json
{
  "Sound.SOUND_CLICK": 1,
  "Sound.SOUND_WIN": 2
}
```

它是语言无关的。C#、GDScript、Lua、JavaScript、C++ 或其他语言都可以加载这份 JSON，并通过符号名解析运行时 ID。

如果 `ref` 目标表配置了 identity，并且被引用的目标字段正好是 `valueColumnId`，下拉选项会显示：

```text
SOUND_CLICK (1)
```

## 8. 导出规则

导出逻辑位于 `src/export/exportTables.ts`。

表导出：

- 导出单张表为 JSON 数组。
- 每一行对应一个对象。
- key 使用 `column.name || column.id`。
- 不输出 `_rowId`、位置、字段配置和编辑器元数据。
- `json` 字段如果是合法 JSON 字符串，导出前会解析。

ID 注册表导出：

- 导出为一个扁平 JSON 对象。
- key 格式是 `${namespace}.${symbolKey}`。
- value 是配置的运行时 ID 字段值。
- key 或 value 为空的行会跳过。
- 浏览器模式会下载 `config_ids.json`。
- 桌面模式会弹出保存路径并写文件。

## 9. 校验规则

校验逻辑位于 `src/validation/validateProject.ts`。

校验问题类型：

```ts
type ValidationIssue = {
  id: string;
  severity: 'error' | 'warning';
  tableId: string;
  rowId?: string;
  columnId?: string;
  message: string;
};
```

已实现校验：

- 字段名为空是错误。
- 一张表存在多个主键字段是错误。
- 主键字段必须必填。
- 主键值不能为空。
- 主键值不能重复。
- 枚举选项为空是警告。
- `ref` 字段必须配置目标表和目标字段。
- `ref` 目标表和目标字段必须存在。
- 必填字段不能为空。
- `int` 必须是整数。
- `float` 必须是有限数字。
- `string` 必须是字符串。
- `bool` 必须是布尔值。
- `enum` 必须在 `enumValues` 中。
- `json` 必须是合法 JSON 值。
- `ref` 值必须存在于目标表/字段中。
- ID 注册表命名空间不能为空。
- 如果配置了 identity，Key 字段和值字段必须存在。
- ID 注册表 Key 不能为空。
- ID 注册表 Key 必须匹配 `^[A-Z][A-Z0-9_]*$`。
- ID 注册表 Key 在表内不能重复。
- ID 注册表运行时值不能为空。
- ID 注册表运行时值在表内不能重复。
- ID 注册表条目在工程内不能重复。

## 10. 保存和加载

### 浏览器模式

浏览器模式行为：

- 保存会下载 `project.configra.json`。
- 加载使用隐藏的文件输入框。
- 选中的文件会先解析并做结构校验，再替换当前工程。
- 加载其他文件前，如果存在未保存修改，会提示保存。

### 桌面模式

桌面模式行为：

- 使用 Tauri 文件对话框和 Rust 命令。
- 启动时尝试加载记录的最近工程路径。
- 如果没有最近工程，则打开示例工程。
- 保存会写入当前工程路径。
- 如果没有工程路径，则保存时弹出保存对话框。
- 打开其他工程前，如果存在未保存修改，会提示保存。
- 关闭应用前，如果存在未保存修改，会提示保存。
- “保存并退出”会先保存，再销毁应用窗口。

`src-tauri/src/lib.rs` 中的 Tauri 命令：

- `read_project_file(path)`
- `write_project_file(path, text)`
- `load_recent_project_path()`
- `save_recent_project_path(path)`

最近工程路径保存在应用配置目录的 `recent-project.txt` 中。

## 11. Store 行为

Store 位于 `src/store/editorStore.ts`。

Store 状态：

- `project`
- `selectedTableId`
- `isDirty`

Store action：

- `selectTable`
- `addTable`
- `updateTable`
- `moveTable`
- `deleteTable`
- `addColumn`
- `updateColumn`
- `deleteColumn`
- `addRow`
- `insertRow`
- `updateCell`
- `deleteRow`
- `deleteRows`
- `loadProject`
- `markClean`
- `resetProject`

脏状态行为：

- 修改型 action 会标记 `isDirty = true`。
- 加载工程会标记为干净。
- 保存工程会标记为干净。
- 仅选中表不会标记为脏。
- 表位置变化小于阈值时会被 `samePosition` 忽略。

自增行为：

- 字段只有同时是 `primary` 和 `int` 时才能启用自增。
- 新行优先使用最后一行值 + 1。
- 如果最后一行不是数字，则使用表内最大数字值 + 1。
- 如果没有数字值，则从 `1` 开始。
- 用户仍然可以手动修改 ID。

## 12. 快捷键

快捷键实现在 `src/App.tsx`。

全局快捷键：

- `Ctrl+S`：保存工程。
- `Ctrl+O`：加载工程。
- `Ctrl+N`：新建表。
- `S`：保存工程。
- `O`：加载工程。
- `N`：新建表。
- `R`：打开当前选中表的编辑弹窗。
- `F`：给当前选中表新增字段。
- `C`：复制当前选中表 JSON。
- `E`：下载当前选中表 JSON。
- `M`：切换小地图。
- `Delete`：删除当前选中表。

事件目标在以下元素中时，不触发全局快捷键：

- `input`
- `textarea`
- `select`
- `[contenteditable="true"]`

## 13. 国际化

国际化位于 `src/i18n.ts`。

当前语言：

- `zh`
- `en`

默认语言是 `zh`。

添加新的界面文本时：

1. 先在 `en` 对象中添加英文 key。
2. 再在 `zh` 中添加对应中文翻译。
3. 组件中使用 `Translator` 类型。
4. 除非是非本地化技术内容，否则不要硬编码新的可见 UI 文案。

## 14. 源码结构

```text
Configra/
|-- AGENTS.md
|-- README.md
|-- package.json
|-- schemas/
|   `-- data-patch.schema.json
|-- src/
|   |-- App.tsx
|   |-- cli/
|   |   |-- cfg.test.ts
|   |   `-- cfg.ts
|   |-- contextMenu/
|   |   `-- ContextMenu.tsx
|   |-- dataGrid/
|   |   `-- DataGridModal.tsx
|   |-- export/
|   |   `-- exportTables.ts
|   |-- file/
|   |   |-- desktopProjectFile.ts
|   |   `-- projectFile.ts
|   |-- graph/
|   |   |-- GraphCanvas.tsx
|   |   |-- TableNode.tsx
|   |   `-- graphMapping.ts
|   |-- inspector/
|   |   |-- ColumnEditor.tsx
|   |   `-- TableInspector.tsx
|   |-- model/
|   |   |-- referenceSemantics.ts
|   |   |-- sampleProject.ts
|   |   |-- schemaUtils.ts
|   |   `-- types.ts
|   |-- mcp/
|   |   |-- protocol.ts
|   |   |-- server.test.ts
|   |   `-- server.ts
|   |-- patch/
|   |   |-- dataPatch.test.ts
|   |   `-- dataPatch.ts
|   |-- store/
|   |   `-- editorStore.ts
|   |-- validation/
|   |   `-- validateProject.ts
|   |-- i18n.ts
|   |-- main.tsx
|   `-- styles/
|       `-- app.css
`-- src-tauri/
    |-- Cargo.toml
    |-- tauri.conf.json
    `-- src/
        |-- lib.rs
        `-- main.rs
```

## 15. 后续开发规则

继续编辑本项目时，请遵守：

- 保持工程数据里的稳定 ID。
- 不要用展示名作为行数据 key。
- 不要把完整行数据塞进 React Flow 节点。
- 图节点只展示表结构。
- 优先扩展现有 store action，不要在组件中做零散状态变更。
- 校验逻辑集中在 `validateProject.ts`。
- 导出逻辑集中在 `exportTables.ts`。
- 文件解析和结构校验集中在 `projectFile.ts`。
- Tauri 文件系统调用封装在 `desktopProjectFile.ts`。
- 除非用户明确要求，否则不要添加某种特定语言的常量生成；优先使用语言无关 JSON。
- 不要添加偏离游戏配置编辑的大型电子表格功能。
- 不要默默引入商业授权复杂的 UI 或表格依赖。
- 外部 AI 和后续 AI 功能不要直接改 store；应采用 patch/diff/confirm/apply 流程。
- 实时 MCP 工具描述、输入 schema 和调用结果是 MCP 具体调用方式的权威来源；`AGENTS.md` 只记录产品语义、开发约束和总体流程，不复制容易过期的完整 API 手册。
- `ref` 单元格保存目标字段的实际值，不保存目标 `tableId`、`columnId` 或目标行 `_rowId`；相关共享语义集中在 `src/model/referenceSemantics.ts`。

## 16. 验证命令

代码修改后运行：

```bash
npm run build
```

如果修改了 Tauri/Rust 或桌面文件行为，运行：

```bash
cd src-tauri
cargo check
```

如果修改了 UI 行为，也要启动本地应用测试相关流程：

```bash
npm run dev
```

或：

```bash
npm run tauri:dev
```

已知构建警告：

- Vite/Rollup 可能提示 Glide Data Grid 依赖里的 `/*#__PURE__*/` 注释无法解释。
- Vite 可能提示主 chunk 大于 500 kB。

这些警告当前不阻塞构建。

## 17. 当前不做的内容

不要把以下内容当作当前功能：

- 撤销/重做。
- CSV/Excel 导入。
- 多人协作。
- 插件系统。
- 复杂导出模板。
- 发布打包流程打磨。
- 自动更新。
- 权限系统。
- 完整电子表格公式引擎。

## 18. 后续可做方向

比较合理的下一步：

- 基于 store patch 增加撤销/重做。
- 从 JSON 样例反推表结构。
- 增加选中字符串单元格的批量查找替换。
- 增加复制行功能。
- 增加显式的一键导出所有表。
- 桌面模式增加导出目录配置。
- 给导出和校验这些纯函数补测试。
- 如果用户后续明确需要，再把某种语言的代码生成作为独立导出层。

扩展前请先保持最小闭环稳定：表结构、行数据、引用、校验、保存/加载、导出。

## 19. Headless CLI and AI patch flow

A Node CLI is now available and should be used for AI batch work without starting Vite or Tauri.

Commands:

- `npm run --silent cfg -- inspect --project <file> [--table <id|unique-name>] [--offset 0] [--limit 100] [--json]`
- `npm run --silent cfg -- query rows --project <file> --query <file|-> [--json]`
- `npm run --silent cfg -- validate --project <file> [--json]`
- `npm run --silent cfg -- patch check --project <file> --patch <file|-> [--report <file>] [--json]`
- `npm run --silent cfg -- patch apply --project <file> --patch <file|-> --confirm <hash> [--transaction-id <id>] [--backup-dir <directory>] [--report <file>] [--json]`
- `npm run --silent cfg -- patch rollback --project <file> --transaction-id <id> --confirm <current-project-hash> [--backup-dir <directory>] [--json]`
- `npm run --silent cfg -- export table --project <file> --table <id|unique-name> --out <file> [--overwrite] [--json]`
- `npm run --silent cfg -- export all --project <file> --out <directory> [--overwrite] [--json]`
- `npm run --silent cfg -- export ids --project <file> --out <file> [--overwrite] [--json]`

Patch contract:

- Schema: `schemas/data-patch.schema.json`
- Stable IDs only: `tableId`, `columnId`, `_rowId`
- Ordered operations only; later operations see earlier results
- Reject unknown targets, conflicting matches, bad shapes, and stale hashes
- `baseHash` is the SHA-256 of the original project file text
- `patch check` returns a `confirmationHash`
- `patch apply` must receive the matching `--confirm` value
- Patch writes use a project write lock and recheck the byte hash immediately before replacement.
- Backups are unique rotating snapshots in application data, not a project-adjacent `.bak`; related writes may share a `transactionId` and can be rolled back with a current-hash guard. The latest 20 transaction snapshots are retained.

Recommended AI flow:

1. Inspect the project.
2. Generate a JSON patch.
3. Run `patch check --json`.
4. Review the diff, validation delta, and `confirmationHash`.
5. Run `patch apply --confirm <hash> --json`.
6. Run `validate --json`.
7. Export the needed table(s) or `config_ids.json`.

Inspect behavior relevant to references:

- Project inspect returns shared `referenceSemantics` and all resolved `relationships`.
- Table inspect returns the incoming and outgoing relationships involving that table.
- Relationship summaries contain source/target stable IDs and names, target existence, primary status, identity runtime-value status, and cell-value meaning.
- Headless patch row values for `ref` columns still contain the referenced target-column value; schema IDs and `_rowId` values are identifiers only.

Exit codes:

- `0` success
- `1` validation failure or rejected patch
- `2` argument, JSON, or target error
- `3` hash conflict
- `4` filesystem error

## 20. Local MCP service

The source desktop application now manages a local Streamable HTTP MCP service.

- The toolbar Settings entry opens a categorized settings panel; its AI / MCP category starts/stops the service and persists its enabled state.
- The service listens only on `127.0.0.1:37631` and uses a per-install token in the URL.
- The canonical server/source ID is `configra`; initialization advertises tools only. Unsupported `resources/*` calls return `CAPABILITY_NOT_SUPPORTED`.
- The connection URL is available through the toolbar copy button.
- MCP is source desktop only; browser mode and packaged sidecars are not supported yet.
- MCP tools operate only on the current saved project and invoke the headless CLI rather than mutating Zustand.
- Dirty state is scoped: graph layout-only changes do not block MCP preview/apply/export and are preserved when an MCP apply reloads the project.
- Unsaved content changes block MCP modification/export tools by default. The persisted Settings → AI / MCP → “Full Access” switch lets the user explicitly allow all MCP operations; an MCP apply may then replace unsaved content edits.
- MCP modifications remain two-stage: preview returns the exact patch and `confirmationHash`; apply requires both. The public tool schema expands every supported operation as a discriminated union.
- Live MCP tool descriptions, input schemas, and results are the authoritative client contract. External AI clients should not need `AGENTS.md` to reconstruct tool parameters.
- MCP inspect results include `referenceSemantics` plus resolved incoming/outgoing `relationships`, so clients can distinguish schema IDs, row IDs, and the actual target-column values stored in `ref` cells.
- Generic `configra_preview_patch` responses include semantic `referenceChanges` for relationships defined or removed by the ordered operations.
- `configra_preview_define_ref` previews converting an existing field into a `ref`. `configra_preview_assign_refs` accepts stable source/target row IDs, resolves each target row to the referenced target-column value, and accepts `targetRowId: null` to clear a reference. Both return a normal patch and `confirmationHash` for `configra_apply_patch`.
- MCP apply creates or reuses a transaction snapshot in the application config backup directory, returns `transactionId`, and exposes a current-hash-guarded rollback tool.
- While MCP is enabled, the desktop UI can show an AI/MCP activity log window. Hiding it removes the window completely from the canvas; restore it through Settings → AI / MCP → Activity Log. Visibility persists in `localStorage`. The service writes request/tool activity to `mcp-logs.jsonl`, and the UI keeps the latest 300 entries.
- New tables created by AI require `ConfigTable.remark`; new fields require `ConfigColumn.remark`.
- Existing tables/fields do not need remarks added before AI can modify, move, delete, query, or edit their rows.
- MCP lifecycle/config files live in the Tauri application config directory as `mcp-settings.json`, `mcp-context.json`, `mcp-events.json`, and `mcp-logs.jsonl`.

MCP verification should include `src/mcp/server.test.ts`, `src/store/editorStore.test.ts`, `npm run tauri:dev`, service restart persistence, scoped dirty access, Full Access persistence, log-window hide/restore through Settings, and process cleanup after disabling or closing the application.
