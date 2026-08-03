# Configra（配表匠）

**中文名：配表匠**

`Configra` 是一个面向游戏配置数据的蓝图式表格编辑器。它用于编辑结构化配置表、可视化表之间的引用关系、校验数据，并导出运行时需要的 JSON。

当前应用同时支持两种运行形态：

- Vite Web 应用。
- Tauri 本地桌面应用。

## 当前功能

- 使用 React Flow 展示可拖动的表节点。
- 根据 `ref` 字段自动生成表到表的关系箭头。
- 左侧表列表支持点击选中、双击编辑，显示备注和字段/行数统计，宽度可拖动调整并记忆。
- 使用 Glide Data Grid 在弹窗中编辑行数据。
- 表属性、字段编辑、问题列表都集成在行数据编辑弹窗中。
- 行数据编辑弹窗支持全屏、内置搜索并定位到匹配单元格、填充柄和平滑滚动。
- 行号可点击；支持多行、多矩形选择。
- 字段类型支持 `int`、`float`、`string`、`bool`、`enum`、`ref`、`json`。
- 字段支持主键、必填、自增。
- 字段可用 `export: false` 从导出中排除。
- `enum` 和 `ref` 单元格使用下拉编辑，下拉支持输入过滤搜索。
- `ref` 单元格可跳转到被引用的目标行（单元格内导航按钮或右键“跳转到引用行”）。
- 行数据编辑弹窗提供“表格预览”字段总览，展示字段结构、备注、类型、属性徽章和导出标记，点击字段可定位到对应列。
- 表格右键菜单支持上方插入行、下方插入行、追加行、全部大写、复制行 JSON、删除行；列头右键可填写字段备注。
- 粘贴多行文本到单列时，会按非空行自动分配到多行；粘贴超过已有行数时自动创建行。
- 左上角应用菜单集中提供新建工程、保存、导入、导出全部和设置。
- 导出全部会把所有表 JSON 和 `config_ids.json` 导出到目录；覆盖已有文件前确认，桌面模式写后逐个读回校验。
- 导入工程文件时显示合并报告：识别同 ID 或同名的表冲突，可逐表选择覆盖、跳过或重命名，并对比新增/既有校验问题。
- 表右键菜单支持从 JSON 数组导入行数据（粘贴或文件），支持严格模式和自增模式，导入前显示逐行校验报告。
- 画布和表节点右键菜单支持新建表、编辑、单表导出、删除、ID 注册表操作和小地图切换。
- 小地图可隐藏和显示。
- 支持浅色、深色、跟随系统三种主题；默认中文，支持切换英文。
- 顶部工具栏实时显示校验错误和警告数量。
- 支持必填、类型、主键、引用、枚举、JSON、ID 注册表等校验。
- 浏览器模式支持保存/导入 `.configra.json`。
- Tauri 桌面模式支持保存到当前工程文件。
- 桌面模式启动时显示加载屏，窗口标题显示当前工程文件名。
- 桌面模式会自动加载最近打开的工程。
- 桌面模式支持通过“在新窗口中打开”或 `Ctrl+Alt+O` 同时打开多个工程；每个工程独立保存、校验和处理未保存状态，同一路径只会打开一个窗口。
- 新建、导入其他工程或关闭桌面应用前，如果存在未保存修改，会提示保存。
- 支持导出当前表 JSON。
- 支持导出语言无关的 `config_ids.json` ID 注册表。
- 提供 Headless CLI，支持检查、查询、校验、两阶段 patch、事务回滚和导出。
- Tauri 源码桌面模式可启动单一的本机 MCP，供外部 AI 通过 `projectId` 安全操作多个已打开且已保存的工程。
- MCP inspect 会返回 `ref` 语义和已解析的表关系，并提供定义、分配引用的专用预览工具。

## 运行

安装依赖：

```bash
npm install
```

运行 Web 应用：

```bash
npm run dev
```

运行桌面应用：

```bash
npm run tauri:dev
```

Windows 下也可以双击 `start-debug.bat`，或运行 `npm run debug`。首个实例会从 `5173–5273` 自动选择未占用的 Vite 端口，后续实例会复用该仓库已经运行的调试服务和可执行文件，因此可以同时打开多个窗口，且不会误连到另一个仓库的前端服务。

构建 Web 应用：

```bash
npm run build
```

运行测试（Vitest）：

```bash
npm run test
```

检查 Tauri/Rust 部分：

```bash
cd src-tauri
cargo check
```

## 初始界面

应用启动后会显示示例工程，包含两张表：

- `Speaker`
- `Dialogue`

`Dialogue.speaker_id` 引用 `Speaker.id`，所以画布上会显示关系箭头：

```text
Dialogue.speaker_id -> Speaker.id
```

## 界面行为

- 顶部工具栏：左侧是应用菜单（新建工程、保存、导入、导出全部、设置），中间显示当前工程文件名，右侧实时显示错误和警告数量。
- 左侧表列表：点击选中并聚焦画布节点，双击打开行数据编辑弹窗，右键打开表操作菜单；表项显示备注和字段/行数统计，列表宽度可拖动调整（160–420px）并记忆。
- 画布：表节点展示表名、字段列表以及 `PK`、`AI`、必填和 `ref` 目标标记；拖动保存位置，双击打开编辑弹窗，右键打开表操作菜单。
- 右键画布空白处可新建表、复制/下载 ID 注册表或切换小地图。
- 设置面板按“界面”（语言、主题、小地图）和“AI / MCP”分类。
- 除输入框、文本框、下拉框和可编辑控件外，原生浏览器右键菜单会被禁用。

## 主要工作流

1. 在画布上新建或选择一张表。
2. 双击表节点或左侧表列表项，打开编辑弹窗。
3. 在弹窗中编辑表名、ID 注册表、字段和行数据。
4. 将字段类型设置为 `ref`，并选择目标表和目标字段。
5. 根据问题列表修复校验错误。
6. 右键表节点，复制或导出该表 JSON，或使用“导入 JSON”批量导入行数据。
7. 使用左上角应用菜单新建、保存、导入或导出工程；右键画布空白处可新建表、切换小地图或导出 `config_ids.json`。

## `ref` 引用语义

`ref` 包含两个不同层次的信息：

- 字段结构通过稳定的目标 `tableId` 和 `columnId` 定义引用关系。
- 源表的每个 `ref` 单元格保存目标字段的实际值。

例如 `Dialogue.speaker_id -> Speaker.id` 时，字段结构保存目标表和目标字段的稳定 ID；某一行的 `speaker_id` 单元格保存的是对应 `Speaker.id` 值，例如 `1001`。单元格不会保存目标表 ID、目标字段 ID 或目标行 `_rowId`。

目标字段优先选择：

1. 目标表主键。
2. 目标表的 `identity.valueColumnId` 运行时 ID 字段。
3. 其他值唯一且稳定的字段。

如果目标表配置了 identity，`identity.keyColumnId` 是便于代码和界面识别的符号名，`identity.valueColumnId` 通常才是引用单元格保存的运行时值。

## 快捷键

- `Ctrl+S`：保存工程。
- `Ctrl+O`：导入工程。
- `Ctrl+Shift+N`：新建空白工程。
- `Ctrl+N`：新建表。
- `S`：保存工程。
- `O`：导入工程。
- `N`：新建表。
- `R`：打开当前选中表的编辑弹窗。
- `F`：给当前选中表新增字段。
- `C`：复制当前选中表 JSON。
- `E`：导出当前选中表 JSON。
- `M`：切换小地图显示状态。
- `Delete`：删除当前选中表。

当焦点在 `input`、`textarea`、`select` 或可编辑控件内时，全局快捷键不会触发。

## 行数据编辑器

行数据编辑器使用 Glide Data Grid。

编辑行为：

- 单元格双击后进入编辑。
- `bool` 字段显示为布尔值。
- `int` 和 `float` 字段会按数字解析输入。
- `enum` 字段使用字段配置中的枚举选项。
- `ref` 字段使用目标表目标字段的值作为选项，下拉支持输入过滤搜索。
- `json` 字段允许输入合法 JSON 字符串，导出时会尽量解析为 JSON 值。
- 已有行下方会显示空白行，编辑空白行会自动创建新行。
- 如果主键字段是第一列，该列会冻结。
- 每张表的列宽会保存到 `localStorage`。
- 内置搜索会定位并高亮匹配单元格，同时显示当前序号和匹配总数。
- 支持填充柄，可快速向下/向右填充。
- 支持平滑滚动；行号可点击（点击即选中整行）。
- `ref` 单元格可以点击单元格内导航按钮或使用右键“跳转到引用行”，直接打开目标表并定位到对应的目标行和字段。
- 行数据编辑弹窗顶部提供“表格预览”按钮，打开字段总览后点击字段名可定位到网格中的对应列。
- 列头悬停会显示字段备注；右键列头可填写或修改字段备注。

粘贴行为：

- 支持普通矩形区域粘贴。
- 单列粘贴时，如果内容包含换行或空行，会拆成多行；每个非空、去除首尾空白后的文本占一行。
- 粘贴超过已有行数时会自动创建新行；粘贴值会按字段类型解析。

右键行为：

- 如果右键点中的是有效的 `ref` 单元格，会显示“跳转到引用行”，打开目标表并定位到对应单元格。
- 上方插入行。
- 下方插入行。
- 追加到末尾。
- 全部大写。
- 复制当前行或选中行 JSON。
- 删除当前行或选中行。

`全部大写` 只会影响 `string` 类型单元格。右键目标不是字符串单元格时，该选项会禁用。

## 数据模型

行数据通过稳定的字段 ID 保存。重命名字段只会修改 `column.name`，不会修改 `column.id`。

```ts
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
  type: 'int' | 'float' | 'string' | 'bool' | 'enum' | 'ref' | 'json';
  required?: boolean;
  primary?: boolean;
  autoIncrement?: boolean;
  export?: boolean;
  remark?: string;
  enumValues?: string[];
  ref?: {
    tableId: string;
    columnId: string;
  };
};

export type ConfigRow = {
  _rowId: string;
  values: Record<string, unknown>;
};
```

重要 ID 规则：

- `table.id` 是内部稳定 ID。
- `column.id` 是内部稳定 ID。
- `row._rowId` 只用于编辑器内部。
- 导出的表 JSON 使用 `column.name || column.id` 作为字段名。
- 导出的表 JSON 不包含 `_rowId`。

## ID 注册表

有些游戏配置需要同时满足代码可读的符号名和运行时数值 ID：

```text
key             id      path
SOUND_CLICK      1      res://audio/click.wav
SOUND_WIN        2      res://audio/win.wav
```

可以为表配置 ID 注册表：

```ts
identity: {
  namespace: 'Sound',
  keyColumnId: 'key',
  valueColumnId: 'id'
}
```

导出的 `config_ids.json`：

```json
{
  "Sound.SOUND_CLICK": 1,
  "Sound.SOUND_WIN": 2
}
```

这个格式是语言无关的。任何语言的游戏代码都可以加载该注册表，并把符号名解析为运行时 ID。

当目标表配置了 ID 注册表，并且引用目标字段正好是运行时 ID 字段时，`ref` 下拉选项会显示：

```text
SOUND_CLICK (1)
```

## 导出规则

表 JSON：

- 输出数组。
- 每行输出一个对象。
- 对象 key 使用字段展示名。
- 不输出 `_rowId` 和编辑器内部元数据。
- `export: false` 的字段会被跳过。
- `json` 字段如果是合法 JSON 字符串，导出时会解析为 JSON 值。

ID 注册表 JSON：

- 输出一个扁平对象。
- key 格式为 `${namespace}.${symbolKey}`。
- value 来自配置的运行时 ID 字段。
- key 或 value 为空的行会跳过。

一键导出全部表时使用当前编辑器内存中的数据，包括尚未保存到工程文件的修改。文件名会做安全化处理，重名自动加数字后缀；桌面模式先选择目标目录，覆盖已有文件前会确认，写完后逐个读回校验，全部一致才显示成功；浏览器模式优先使用目录选择器，否则逐个下载文件。

## 保存和导入

浏览器模式：

- 保存会下载 `project.configra.json`。
- 导入会打开文件选择器，先解析并做结构校验，再显示合并报告。

桌面模式：

- 启动时会尝试加载最近保存或打开的工程路径，加载期间显示启动屏。
- 如果没有最近工程，则显示示例工程。
- 保存会写回当前工程文件。
- 新工程没有文件路径时，第一次保存会弹出保存位置选择框。
- 新建或导入其他工程前，如果有未保存修改，会提示保存。
- 关闭应用前，如果有未保存修改，会提示保存。
- 窗口标题会显示当前工程文件名。

### 导入与合并

导入工程文件时不会直接替换当前工程，而是先显示导入报告：

- 自动检测与当前工程的冲突：待导入表的稳定 ID 已存在于当前工程，或表 ID 不同但表名相同。
- 每个冲突表可选择“覆盖”“跳过”或“重命名”；重命名会生成新的显示名（必要时新的稳定 ID），并自动更新指向该表的 `ref` 目标。
- 无冲突的新表直接加入；位置与现有表重叠时自动偏移。
- 报告会列出合并后候选工程的校验问题，并标注“新增”与“既有”；存在新增错误或导入文件为空时不允许导入。

Tauri 命令实现位置是 `src-tauri/src/lib.rs`：

- `read_project_file`
- `write_project_file`
- `load_recent_project_path`
- `save_recent_project_path`

## 校验

校验器返回 `ValidationIssue`：

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
- 必填字段不能为空。
- `int` 必须是整数。
- `float` 必须是有限数字。
- `string` 必须是字符串。
- `bool` 必须是布尔值。
- `enum` 必须在 `enumValues` 中。
- `json` 必须是合法 JSON 值。
- `ref` 必须能在目标表目标字段中找到对应值。
- 每张表最多只能有一个主键字段。
- 主键必须必填、非空、唯一。
- `ref` 字段必须配置有效的目标表和目标字段。
- 枚举选项为空时显示警告。
- ID 注册表命名空间不能为空。
- 配置了 ID 注册表时，必须选择符号 Key 字段和运行时 ID 字段。
- ID 注册表 Key 必须匹配 `^[A-Z][A-Z0-9_]*$`。
- ID 注册表 Key 和运行时 ID 在表内必须唯一。
- ID 注册表条目在整个工程中必须唯一。

## 源码结构

```text
Configra/
|-- AGENTS.md
|-- README.md
|-- package.json
|-- scripts/
|   `-- start-debug.mjs
|-- schemas/
|   `-- data-patch.schema.json
|-- src/
|   |-- appMenu/
|   |   `-- AppMenu.tsx
|   |-- App.tsx
|   |-- cli/
|   |   |-- cfg.test.ts
|   |   `-- cfg.ts
|   |-- contextMenu/
|   |   `-- ContextMenu.tsx
|   |-- dataGrid/
|   |   |-- DataGridModal.tsx
|   |   |-- TablePreviewModal.tsx
|   |   |-- choiceSearch.ts
|   |   |-- choiceSearch.test.ts
|   |   |-- referenceNavigation.ts
|   |   `-- referenceNavigation.test.ts
|   |-- export/
|   |   |-- desktopExport.test.ts
|   |   |-- desktopExport.ts
|   |   `-- exportTables.ts
|   |-- file/
|   |   |-- desktopProjectFile.ts
|   |   `-- projectFile.ts
|   |-- graph/
|   |   |-- GraphCanvas.tsx
|   |   |-- TableNode.tsx
|   |   |-- graphMapping.test.ts
|   |   `-- graphMapping.ts
|   |-- import/
|   |   |-- ImportReportDialog.tsx
|   |   |-- TableImportDialog.tsx
|   |   |-- mergeProject.test.ts
|   |   |-- mergeProject.ts
|   |   |-- tableRowImport.test.ts
|   |   `-- tableRowImport.ts
|   |-- inspector/
|   |   |-- ColumnEditor.tsx
|   |   `-- TableInspector.tsx
|   |-- mcp/
|   |   |-- McpLogWindow.tsx
|   |   |-- protocol.ts
|   |   |-- server.test.ts
|   |   `-- server.ts
|   |-- model/
|   |   |-- projectFactory.ts
|   |   |-- referenceSemantics.ts
|   |   |-- rowFactory.ts
|   |   |-- sampleProject.ts
|   |   |-- schemaUtils.ts
|   |   `-- types.ts
|   |-- patch/
|   |   |-- dataPatch.test.ts
|   |   `-- dataPatch.ts
|   |-- settings/
|   |   `-- SettingsPanel.tsx
|   |-- startup/
|   |   `-- StartupScreen.tsx
|   |-- store/
|   |   |-- editorStore.test.ts
|   |   `-- editorStore.ts
|   |-- validation/
|   |   |-- validateProject.test.ts
|   |   `-- validateProject.ts
|   |-- i18n.ts
|   |-- main.tsx
|   |-- theme.ts
|   `-- styles/
|       `-- app.css
`-- src-tauri/
    |-- Cargo.toml
    |-- tauri.conf.json
    |-- capabilities/
    |   `-- default.json
    `-- src/
        |-- lib.rs
        `-- main.rs
```

## 当前不做的内容

- 撤销/重做。
- CSV 或 Excel 导入。
- 多人协作。
- 插件系统。
- 复杂导出模板。
- 安装包、自动更新或发布流程打磨。
- 权限系统。
- 完整电子表格公式引擎。

项目应继续聚焦游戏配置编辑闭环：表结构、行数据、引用、校验、保存/加载和 JSON 导出。

## Headless CLI

Run batch edits without starting Vite or Tauri:

```bash
npm run --silent cfg -- inspect --project <file> [--table <id|unique-name>] [--offset 0] [--limit 100] [--json]
npm run --silent cfg -- query rows --project <file> --query <file|-> [--json]
npm run --silent cfg -- validate --project <file> [--json]
npm run --silent cfg -- patch check --project <file> --patch <file|-> [--report <file>] [--json]
npm run --silent cfg -- patch apply --project <file> --patch <file|-> --confirm <hash> [--transaction-id <id>] [--backup-dir <directory>] [--report <file>] [--json]
npm run --silent cfg -- patch rollback --project <file> --transaction-id <id> --confirm <current-project-hash> [--backup-dir <directory>] [--json]
npm run --silent cfg -- export table --project <file> --table <id|unique-name> --out <file> [--overwrite] [--json]
npm run --silent cfg -- export all --project <file> --out <directory> [--overwrite] [--json]
npm run --silent cfg -- export ids --project <file> --out <file> [--overwrite] [--json]
```

Patch files use stable IDs only and follow `schemas/data-patch.schema.json`.

不指定 `--table` 的 inspect 会返回工程级 `referenceSemantics` 和 `relationships`；表级 inspect 会返回与该表有关的传入、传出关系。关系摘要包含源/目标稳定 ID、展示名、目标是否存在，以及目标字段是否为主键或 identity 运行时值字段。

Recommended AI flow:

1. Inspect the project and table.
2. Generate a JSON patch.
3. Run `patch check` and review the diff plus `confirmationHash`.
4. Run `patch apply` with the matching `--confirm` value.
5. Run `validate`.
6. Export the needed table(s) or `config_ids.json`.

`patch apply` creates a unique original snapshot in the application data backup directory. Reuse an explicit `transactionId` for related writes; compensating writes in that transaction restore the original bytes. `patch rollback` requires both the transaction ID and the current project hash, so it cannot silently roll back a stale revision. The latest 20 transaction snapshots are retained.

Exit codes:

- `0` success
- `1` validation failure or rejected patch
- `2` argument, JSON, or target error
- `3` hash conflict
- `4` filesystem error

## 本机 MCP

源码桌面模式提供本机 Streamable HTTP MCP：

1. 运行 `npm run tauri:dev`。
2. 打开顶部“设置”，进入“AI / MCP”分类并开启本机 MCP 服务。
3. 在设置面板中点击“复制 MCP 地址”，把地址配置到支持 Streamable HTTP 的 AI 客户端。

服务只监听 `127.0.0.1`，默认端口是 `37631`。可以在“设置 → AI / MCP”中开启/关闭服务、修改或恢复默认端口、重启服务、切换日志窗口显示和复制连接地址；端口和开关状态都会写入应用配置目录的 `mcp-settings.json`，下次启动桌面应用时继续使用。连接地址固定为 `http://127.0.0.1:<端口>/mcp`，不再包含访问 Token。

服务的 canonical ID 是 `configra`，初始化能力只声明 `tools`。不支持的 `resources/*` 请求会稳定返回 `CAPABILITY_NOT_SUPPORTED`，不会被伪装成另一个资源服务器。

MCP 只操作桌面窗口中已打开且已保存的工程，并通过 Headless CLI 完成检查、两阶段 patch、校验和导出。`configra_list_projects` 返回当前工程及其 `projectId`；当打开多个工程时，所有工程相关工具都必须显式传入目标 `projectId`，避免依赖当前焦点窗口猜测目标。仅蓝图布局发生变化时不会阻断该工程的 MCP，应用 patch 后会保留未保存的节点位置；存在未保存的内容修改时默认拒绝修改和导出。用户可以通过“设置 → AI / MCP → 完全访问”按工程明确放行 MCP 操作，此时 MCP 应用可能替换该工程窗口中未保存的内容，但不会授权其他工程。

MCP 启用后，右下角会显示 AI/MCP 活动日志窗口，展示连接、工具调用记录及工具显式指定的 `projectId`。收起后窗口会变成右下角的小按钮，点击即可恢复；该偏好会保存在 `localStorage`。日志保存在应用配置目录的 `mcp-logs.jsonl` 中，日志窗口右键菜单可以清空当前日志。

### MCP 自解释契约

支持 MCP 的 AI 客户端会直接获得工具描述和完整输入 Schema。实时 MCP schema 是具体调用方式的权威来源，`README.md` 和 `AGENTS.md` 只记录产品语义、开发约束与总体工作流，不要求 AI 依靠文档猜测工具参数。

inspect 结果中的 `referenceSemantics` 会说明 `ref` 单元格保存目标字段实际值；`relationships` 会解析当前工程的传入、传出关系。通用 `configra_preview_patch` 还会为结构引用变更返回 `referenceChanges`。

当前工具分组：

- 状态与工程路由：`configra_get_status`、`configra_list_projects`。
- 读取：`configra_inspect_project`、`configra_inspect_table`、`configra_query_rows`。
- 校验：`configra_validate`。
- 通用修改预览：`configra_preview_patch`。
- 引用预览：`configra_preview_define_ref`、`configra_preview_assign_refs`。
- 应用与恢复：`configra_apply_patch`、`configra_rollback_transaction`。
- 导出：`configra_export_table`、`configra_export_ids`、`configra_export_all`。

所有修改仍采用两阶段流程：preview 返回目标 `projectId`、精确 `patch` 和绑定该项目的 `confirmationHash`，apply 必须对同一工程原样提交后二者。即使两个工程文件内容完全相同，A 工程的确认值也不能用于 B 工程。ref 专用工具不会绕过 patch 校验、工程哈希、写锁、事务快照或校验增量。

### AI 使用 `ref` 的推荐流程

1. 先调用 `configra_list_projects` 选择目标 `projectId`，再调用 `configra_inspect_project` 并检查源表和目标表，读取 `referenceSemantics`、`relationships`、稳定字段 ID 和行 `_rowId`。
2. 对已有字段调用 `configra_preview_define_ref`，传入源表、源字段、目标表和目标字段的稳定 ID。
3. 审查 diff、关系摘要和 `confirmationHash`，使用 `configra_apply_patch` 应用原样返回的 patch。
4. 调用 `configra_preview_assign_refs`，按 `{ sourceRowId, targetRowId }` 表达“源行关联目标行”。服务会读取目标字段的实际值并生成普通 `updateRows` patch；不会把 `targetRowId` 写进单元格。
5. 传入 `targetRowId: null` 可以清除该源行的引用。
6. 应用后重新 inspect 并调用 `configra_validate`，最后导出受影响的表；identity 有变化时同时导出 `config_ids.json`。

其他 MCP 能力包括：

- 工程/表分页检查和按字段查询。
- 完整校验。
- 通用两阶段 patch；公开输入 Schema 会展开全部补丁操作。
- 带当前项目哈希保护的事务回滚。
- 单表、全部表和 ID 注册表导出。

AI 新建表时必须提供表备注；AI 新建字段时必须提供字段备注。修改、移动或删除已有结构，以及所有行数据操作，不要求给已有无备注结构补备注。
