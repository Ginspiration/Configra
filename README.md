# Game Config Graph Editor

`Game Config Graph Editor` 是一个面向游戏配置数据的蓝图式表格编辑器。它用于编辑结构化配置表、可视化表之间的引用关系、校验数据，并导出运行时需要的 JSON。

当前应用同时支持两种运行形态：

- Vite Web 应用。
- Tauri 本地桌面应用。

## 当前功能

- 使用 React Flow 展示可拖动的表节点。
- 根据 `ref` 字段自动生成表到表的关系箭头。
- 左侧表列表支持点击选中、双击编辑。
- 使用 Glide Data Grid 在弹窗中编辑行数据。
- 表属性、字段编辑、问题列表都集成在行数据编辑弹窗中。
- 行数据编辑弹窗支持全屏。
- 字段类型支持 `int`、`float`、`string`、`bool`、`enum`、`ref`、`json`。
- 字段支持主键、必填、自增。
- `enum` 和 `ref` 单元格使用下拉编辑。
- 表格支持多行、多单元格选择。
- 粘贴多行文本到单列时，会按非空行自动分配到多行。
- 表格右键菜单支持上方插入行、下方插入行、追加行、全部大写、复制行 JSON、删除行。
- 画布和表节点右键菜单支持新建、编辑、导出、保存、加载、删除、小地图切换。
- 小地图可隐藏和显示。
- 默认中文，支持切换英文。
- 支持必填、类型、主键、引用、枚举、JSON、ID 注册表等校验。
- 浏览器模式支持保存/加载 `.cfggraph.json`。
- Tauri 桌面模式支持保存到当前工程文件。
- 桌面模式会自动加载最近打开的工程。
- 加载其他工程或关闭桌面应用前，如果存在未保存修改，会提示保存。
- 支持导出当前表 JSON。
- 支持导出语言无关的 `config_ids.json` ID 注册表。

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

构建 Web 应用：

```bash
npm run build
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

## 主要工作流

1. 在画布上新建或选择一张表。
2. 双击表节点或左侧表列表项，打开编辑弹窗。
3. 在弹窗中编辑表名、ID 注册表、字段和行数据。
4. 将字段类型设置为 `ref`，并选择目标表和目标字段。
5. 根据问题列表修复校验错误。
6. 右键表节点，复制或导出该表 JSON。
7. 右键画布空白处，保存/加载工程、新建表、切换小地图，或导出 `config_ids.json`。

## 快捷键

- `Ctrl+S`：保存工程。
- `Ctrl+O`：加载工程。
- `Ctrl+N`：新建表。
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
- `ref` 字段使用目标表目标字段的值作为选项。
- `json` 字段允许输入合法 JSON 字符串，导出时会尽量解析为 JSON 值。
- 已有行下方会显示空白行，编辑空白行会自动创建新行。
- 如果主键字段是第一列，该列会冻结。
- 每张表的列宽会保存到 `localStorage`。

粘贴行为：

- 支持普通矩形区域粘贴。
- 单列粘贴时，如果内容包含换行或空行，会拆成多行；每个非空、去除首尾空白后的文本占一行。

右键行为：

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
- `json` 字段如果是合法 JSON 字符串，导出时会解析为 JSON 值。

ID 注册表 JSON：

- 输出一个扁平对象。
- key 格式为 `${namespace}.${symbolKey}`。
- value 来自配置的运行时 ID 字段。
- key 或 value 为空的行会跳过。

## 保存和加载

浏览器模式：

- 保存会下载 `game-config.cfggraph.json`。
- 加载会打开文件选择器，读取并校验后替换当前工程。

桌面模式：

- 启动时会尝试加载最近保存或打开的工程路径。
- 如果没有最近工程，则显示示例工程。
- 保存会写回当前工程文件。
- 新工程没有文件路径时，第一次保存会弹出保存位置选择框。
- 加载其他工程前，如果有未保存修改，会提示保存。
- 关闭应用前，如果有未保存修改，会提示保存。

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
game-config-graph-editor/
|-- AGENTS.md
|-- README.md
|-- package.json
|-- src/
|   |-- App.tsx
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
|   |   |-- sampleProject.ts
|   |   |-- schemaUtils.ts
|   |   `-- types.ts
|   |-- store/
|   |   `-- editorStore.ts
|   |-- validation/
|   |   `-- validateProject.ts
|   |-- i18n.ts
|   `-- styles/
|       `-- app.css
`-- src-tauri/
    `-- src/
        `-- lib.rs
```

## 当前不做的内容

- AI 辅助编辑。
- 撤销/重做。
- CSV 或 Excel 导入。
- 多人协作。
- 插件系统。
- 复杂导出模板。
- 安装包、自动更新或发布流程打磨。

项目应继续聚焦游戏配置编辑闭环：表结构、行数据、引用、校验、保存/加载和 JSON 导出。
