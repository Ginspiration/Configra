# 游戏配置蓝图式表格编辑器开发文档

本文档用于新建项目后交给 AI / 开发者接手实现。当前仓库是 Godot 游戏项目，**不要在当前 Godot 项目里实现本工具**。请另建一个独立前端/桌面项目。

工具暂定名：`Game Config Graph Editor`。名字可改，核心目标不要改。

## 1. 产品目标

做一个**游戏配置专用的蓝图式表格编辑器**。

第一版只解决一个闭环：

```text
新建表
新建字段
填写行数据
设置字段引用关系
用箭头可视化表关系
校验数据
每张表导出独立 JSON
保存/加载工程文件
```

它不是 Excel，不追求完整电子表格能力；它也不是一开始就 AI 自动生成配置。它是一个面向游戏配置的结构化数据编辑器。

后续 AI 只作为增强能力：理解当前表结构和已有数据，帮用户追加行、批量改数据、解释错误和生成测试数据。

## 2. 第一版边界

### 必须实现

- 画布上显示多张可拖动的表节点。
- 每张表有字段列表。
- 字段支持名称、类型、主键、必填、引用目标。
- 选中表后，可以编辑字段。
- 选中表后，可以编辑行数据。
- `ref` 字段自动生成表之间的箭头。
- 支持基础校验。
- 支持保存/加载 `.cfggraph.json` 工程文件。
- 支持按表导出 JSON。

### 暂不实现

- AI。
- 复杂公式。
- 撤销/重做。
- 多人协作。
- CSV/Excel 导入。
- 大型表格虚拟滚动。
- 插件系统。
- 复杂导出模板。
- 权限系统。

第一版目标是能跑通，而不是一次做成完整产品。

说明：桌面端是推荐方向，但第一版不要把桌面打包、安装包、自动更新、本地文件系统权限作为核心难点。先用 Web 形态跑通编辑器闭环；如果核心交互成立，再接入 Tauri，让工具可以直接打开项目目录并读写配置文件。

## 3. 推荐技术栈

使用可商用开源库，优先 MIT / Apache-2.0。

```text
Vite
React
TypeScript
React Flow
Zustand
普通 HTML table + input
```

说明：

- `React Flow`：用于蓝图画布、节点拖拽、连线渲染。MIT。
- `Zustand`：轻量状态管理。MIT。
- 第一版先不要接入复杂表格库，直接用 HTML table 验证产品形态。
- 后续如果需要大量数据编辑，再接 `Glide Data Grid`。Glide Data Grid 是 MIT，适合高性能表格编辑。
- 桌面版推荐用 `Tauri`，它是 MIT / Apache-2.0。Tauri 适合在第二阶段接入，用来支持打开项目目录、直接保存工程文件、直接导出 JSON 到游戏项目。

不建议第一版使用：

- Handsontable：商业使用许可容易复杂。
- AG Grid Enterprise：商业授权。
- MUI X Pro/Premium：商业授权。
- 完整 Office/Spreadsheet SDK：第一版太重。

## 4. 界面布局

推荐三栏 + 底部数据区：

```text
┌──────────────────────────────────────────────────────┐
│ 顶部工具栏：新建表 / 保存 / 加载 / 校验 / 导出 JSON    │
├───────────────┬───────────────────────┬──────────────┤
│ 左侧表列表     │ 中间蓝图画布           │ 右侧属性面板  │
│ Tables        │ React Flow             │ Inspector    │
├───────────────┴───────────────────────┴──────────────┤
│ 底部数据编辑区：当前选中表的行数据                     │
└──────────────────────────────────────────────────────┘
```

### 中间画布

画布节点只展示表结构，不展示大量行数据。

节点示例：

```text
Dialogue
────────────────
id          int      PK
desc        string
speaker_id  ref  -> Speaker.id
```

节点交互：

- 拖动节点改变位置。
- 点击节点选中表。
- 字段为 `ref` 时，在画布上显示箭头。

### 右侧属性面板

选中表时显示：

- 表 ID。
- 表名。
- 字段列表。
- 新增字段。
- 删除字段。
- 修改字段名。
- 修改字段类型。
- 设置主键。
- 设置必填。
- 设置 ref 目标表和目标字段。

### 底部数据编辑区

选中表时显示行数据。

第一版使用普通 HTML table：

- 每列对应一个字段。
- 每行对应一条数据。
- 单元格用 input / select 编辑。
- `bool` 用 checkbox。
- `enum` 用 select。
- `ref` 用 select，选项来自目标表目标字段的所有值。

## 5. 数据模型

核心类型建议如下：

```ts
export type ColumnType =
  | 'int'
  | 'float'
  | 'string'
  | 'bool'
  | 'enum'
  | 'ref'
  | 'json';

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
};

export type GraphPosition = {
  x: number;
  y: number;
};

export type ConfigColumn = {
  id: string;
  name: string;
  type: ColumnType;
  required?: boolean;
  primary?: boolean;
  enumValues?: string[];
  ref?: ColumnRef;
};

export type ColumnRef = {
  tableId: string;
  columnId: string;
};

export type ConfigRow = {
  _rowId: string;
  values: Record<string, unknown>;
};
```

注意：

- `table.id` 是内部稳定 ID，不要直接依赖展示名。
- `column.id` 是内部稳定 ID，字段重命名时不要改变 ID。
- `row._rowId` 是编辑器内部行 ID，导出 JSON 时默认不输出。
- 行数据放在 `values` 中，key 使用 `column.id`。

## 6. 示例工程

应用首次打开时，内置一个默认示例。

```json
{
  "version": 1,
  "tables": [
    {
      "id": "speaker",
      "name": "Speaker",
      "position": { "x": 120, "y": 120 },
      "columns": [
        { "id": "id", "name": "id", "type": "int", "primary": true, "required": true },
        { "id": "name", "name": "name", "type": "string", "required": true }
      ],
      "rows": [
        { "_rowId": "row_speaker_1", "values": { "id": 1001, "name": "人类" } },
        { "_rowId": "row_speaker_2", "values": { "id": 1002, "name": "旁白" } }
      ]
    },
    {
      "id": "dialogue",
      "name": "Dialogue",
      "position": { "x": 460, "y": 120 },
      "columns": [
        { "id": "id", "name": "id", "type": "int", "primary": true, "required": true },
        { "id": "desc", "name": "desc", "type": "string", "required": true },
        {
          "id": "speaker_id",
          "name": "speaker_id",
          "type": "ref",
          "required": true,
          "ref": { "tableId": "speaker", "columnId": "id" }
        }
      ],
      "rows": [
        {
          "_rowId": "row_dialogue_1",
          "values": {
            "id": 1,
            "desc": "上帝为什么要创造我",
            "speaker_id": 1001
          }
        },
        {
          "_rowId": "row_dialogue_2",
          "values": {
            "id": 2,
            "desc": "今天心情不错",
            "speaker_id": 1001
          }
        }
      ]
    }
  ]
}
```

画布上应显示：

```text
Dialogue.speaker_id -> Speaker.id
```

## 7. 导出 JSON 规则

每张表导出一个独立 JSON 文件。

导出时：

- 输出数组。
- 每一行输出一个对象。
- key 使用字段展示名 `column.name`。
- 不输出 `_rowId`。
- 不输出编辑器内部元数据。

`Speaker` 导出：

```json
[
  { "id": 1001, "name": "人类" },
  { "id": 1002, "name": "旁白" }
]
```

`Dialogue` 导出：

```json
[
  {
    "id": 1,
    "desc": "上帝为什么要创造我",
    "speaker_id": 1001
  },
  {
    "id": 2,
    "desc": "今天心情不错",
    "speaker_id": 1001
  }
]
```

第一版可以提供两种导出：

- 复制当前表 JSON。
- 下载当前表 JSON。

第二阶段桌面端再做：

- 一键导出所有表。
- zip 下载。
- 导出到指定目录。
- Tauri 桌面端直接写文件。

## 8. 校验规则

第一版实现以下校验。

### 类型校验

- `int`：必须是整数。
- `float`：必须是数字。
- `string`：必须是字符串。
- `bool`：必须是布尔值。
- `enum`：必须在 `enumValues` 内。
- `ref`：值必须存在于目标表目标字段。
- `json`：必须能解析为合法 JSON。

### 必填校验

如果字段 `required = true`，则值不能是：

- `null`
- `undefined`
- 空字符串

### 主键校验

每张表最多一个主键字段。

主键字段：

- 必须 required。
- 不能重复。
- 不能空。

### 引用校验

`ref` 字段必须有：

- 目标表。
- 目标字段。

并且目标字段必须存在。

行数据中引用值必须能在目标字段中找到。

### 错误展示

错误需要包含：

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

UI 中至少显示：

- 顶部错误数量。
- 右侧或底部错误列表。
- 点击错误后选中对应表。

## 9. React Flow 映射

表节点：

```ts
type TableNodeData = {
  tableId: string;
};
```

节点 ID：

```ts
node.id = table.id
```

节点位置：

```ts
node.position = table.position
```

边 ID：

```ts
edge.id = `${fromTableId}.${fromColumnId}->${toTableId}.${toColumnId}`
```

边生成规则：

遍历所有表的所有字段，如果字段类型是 `ref` 且有合法 `ref`，则创建边：

```ts
source = currentTable.id
target = column.ref.tableId
```

第一版不需要精确连到字段级 handle。可以表到表连线。后续再升级为字段级连线。

## 10. 状态管理

推荐使用 Zustand。

Store 至少提供：

```ts
type EditorStore = {
  project: ProjectFile;
  selectedTableId?: string;

  selectTable(tableId: string): void;
  addTable(): void;
  updateTable(tableId: string, patch: Partial<ConfigTable>): void;
  moveTable(tableId: string, position: GraphPosition): void;
  deleteTable(tableId: string): void;

  addColumn(tableId: string): void;
  updateColumn(tableId: string, columnId: string, patch: Partial<ConfigColumn>): void;
  deleteColumn(tableId: string, columnId: string): void;

  addRow(tableId: string): void;
  updateCell(tableId: string, rowId: string, columnId: string, value: unknown): void;
  deleteRow(tableId: string, rowId: string): void;

  loadProject(project: ProjectFile): void;
  resetProject(): void;
};
```

第一版可以不做 undo/redo。

## 11. 文件保存与加载

浏览器版第一版：

- 保存：生成 `.cfggraph.json` 文件下载。
- 加载：用户选择 `.cfggraph.json` 文件，读取后替换当前 project。

保存文件即完整 `ProjectFile`。

加载时必须做基本结构校验：

- `version` 是否支持。
- `tables` 是否为数组。
- 每张表字段是否完整。

加载失败要显示错误，不要让页面崩溃。

## 12. 推荐目录结构

```text
game-config-graph-editor/
├── package.json
├── index.html
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── model/
│   │   ├── types.ts
│   │   └── sampleProject.ts
│   ├── store/
│   │   └── editorStore.ts
│   ├── graph/
│   │   ├── GraphCanvas.tsx
│   │   ├── TableNode.tsx
│   │   └── graphMapping.ts
│   ├── inspector/
│   │   ├── TableInspector.tsx
│   │   └── ColumnEditor.tsx
│   ├── dataGrid/
│   │   └── DataEditor.tsx
│   ├── validation/
│   │   └── validateProject.ts
│   ├── export/
│   │   └── exportTables.ts
│   ├── file/
│   │   └── projectFile.ts
│   └── styles/
│       └── app.css
└── README.md
```

## 13. 开发顺序

严格按这个顺序实现，避免过早做复杂功能。

1. 创建 Vite + React + TypeScript 项目。
2. 安装 React Flow 和 Zustand。
3. 定义 `types.ts` 和 `sampleProject.ts`。
4. 实现 Zustand store。
5. 实现基础布局。
6. 用 React Flow 渲染表节点。
7. 实现拖动节点并保存 position。
8. 根据 `ref` 字段生成表到表箭头。
9. 实现表选择。
10. 实现右侧表/字段编辑。
11. 实现底部行数据编辑。
12. 实现新增表、字段、行。
13. 实现基础校验。
14. 实现导出当前表 JSON。
15. 实现保存/加载工程文件。
16. 简单美化 UI。

每一步完成后都要保证应用可运行。

## 14. UI 风格要求

这个工具是开发工具，不是营销页面。

风格建议：

- 安静。
- 密集但不拥挤。
- 类似编辑器 / 数据库工具。
- 不要做大 Hero。
- 不要做装饰性卡片堆叠。
- 不要做花哨渐变背景。

布局优先级：

```text
信息清晰 > 操作效率 > 视觉装饰
```

按钮建议：

- 顶部工具栏使用清晰文本按钮。
- 后续可接 lucide-react 图标。
- 危险操作如删除表，需要确认。

## 15. 后续 AI 能力预留

第一版不要实现 AI，但代码结构要允许后续加入。

未来 AI 功能建议：

```text
根据当前表结构追加 N 行数据
根据已有行风格补全文案
解释校验错误
批量修改某些行
根据自然语言生成新表结构草稿
根据 JSON 样例反推表结构
```

AI 不应直接修改 store。推荐流程：

```text
AI 生成 patch
展示 diff
用户确认
应用 patch
重新校验
```

## 16. 第一版验收标准

完成后必须能做到：

1. 打开应用看到 `Speaker` 和 `Dialogue` 两张表示例。
2. 画布上两张表可拖动。
3. `Dialogue.speaker_id` 到 `Speaker.id` 有箭头。
4. 可以新建一张表。
5. 可以给表新增字段。
6. 可以添加一行数据。
7. 可以把字段类型设为 `ref` 并选择目标表字段。
8. 引用不存在时能显示错误。
9. 主键重复时能显示错误。
10. 可以导出当前表 JSON。
11. 可以保存 `.cfggraph.json`。
12. 可以重新加载 `.cfggraph.json` 并恢复画布。

只要这些能跑通，第一版就是成功的。

## 17. 重要取舍

不要试图第一版复刻 Excel。

不要把完整行数据塞进画布节点。

不要先做 AI。

不要先把桌面打包、本地文件系统、自动更新作为第一版中心。

推荐节奏：

```text
第一阶段：Web 形态，跑通表结构、行数据、引用、校验、导出。
第二阶段：Tauri 桌面端，支持打开项目目录、直接读写 .cfggraph.json 和导出 JSON。
```

不要为了导出做复杂模板系统。

先把“表结构、行数据、引用关系、JSON 导出”这个最小闭环做稳定。
