# AI 表元数据自动编辑指南

本文档给后续 AI 使用：当用户说“新建一张表”“新建多张表”“更新某张表”“更新每个表”时，AI 应该按本文档修改游戏配置编辑器的工程元数据文件，而不是修改导出的运行时 JSON。

典型工程元数据文件示例：

```text
D:\project\godot\3\resource\json\game-config.cfggraph.json
```

## 1. 操作边界

只编辑 `.cfggraph.json` 工程文件里的元数据：

```json
{
  "version": 1,
  "tables": []
}
```

不要把以下文件当作编辑目标：

- 单张表导出的运行时 JSON，例如 `Item.json`、`Monster.json`、`Skill.json`。
- ID 注册表导出的 `config_ids.json`。
- 游戏运行时已经使用的导出产物。

如果用户只给了一个路径，先判断：

- 文件名类似 `game-config.cfggraph.json`：可以作为工程元数据编辑。
- 文件名类似 `config_ids.json`：这是导出文件，不能作为表结构编辑目标。
- 文件内容根对象没有 `version: 1` 和 `tables` 数组：不是本工具工程文件，先询问用户。

## 2. 基本原则

- `table.id` 是稳定内部 ID。创建后不要因为改表名而改它。
- `column.id` 是稳定内部 ID。创建后不要因为改字段名而改它。
- `row.values` 必须用 `column.id` 做 key，不要用 `column.name` 做 key。
- `_rowId` 是编辑器内部行 ID，不参与导出，但在工程文件里必须保留。
- 表 JSON 导出时才使用 `column.name || column.id` 作为输出 key。
- 引用关系使用 `column.ref.tableId` 和 `column.ref.columnId` 指向目标表/目标字段。
- 图节点位置存在 `table.position`，新表必须给一个合理位置。
- 如果需要批量更新，尽量保持已有表、字段、行的稳定 ID 不变。

## 3. 当前元数据结构

工程文件：

```ts
type ProjectFile = {
  version: 1;
  tables: ConfigTable[];
};
```

表：

```ts
type ConfigTable = {
  id: string;
  name: string;
  position: { x: number; y: number };
  columns: ConfigColumn[];
  rows: ConfigRow[];
  identity?: TableIdentity;
};
```

字段：

```ts
type ConfigColumn = {
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
```

行：

```ts
type ConfigRow = {
  _rowId: string;
  values: Record<string, unknown>;
};
```

ID 注册表：

```ts
type TableIdentity = {
  namespace?: string;
  keyColumnId?: string;
  valueColumnId?: string;
};
```

## 4. AI 执行流程

### 4.1 收到用户需求后先做判断

用户可能会这样说：

- “帮我新建一张技能表。”
- “帮我新建 Item、Monster、Drop 三张表。”
- “把每张表都加一个 remark 字段。”
- “更新所有表，让主键 id 都自增。”
- “给 Quest 表加一个 reward_item_id 引用 Item.id。”

AI 应先判断需求属于哪类：

- 新建表。
- 新建多张表。
- 更新已有表结构。
- 更新已有行数据。
- 批量更新所有表。
- 设置字段引用关系。
- 设置 ID 注册表。

如果缺少关键业务信息，可以做最小合理假设，但以下情况必须询问用户：

- 没有工程文件路径，且当前上下文无法确认。
- 引用目标不明确，例如“关联物品”但工程里有多张物品相关表。
- 批量删除或重命名会造成大量数据丢失。
- 用户要求修改的是导出 JSON，而不是 `.cfggraph.json` 工程文件。

### 4.2 修改前读取工程文件

1. 读取目标 `.cfggraph.json`。
2. 用 JSON 解析，不要用纯文本替换。
3. 确认根对象：

```json
{
  "version": 1,
  "tables": []
}
```

4. 确认每张表都有：

- `id`
- `name`
- `position`
- `columns`
- `rows`

5. 修改前建议在同目录创建备份，例如：

```text
game-config.cfggraph.backup-20260713-153000.json
```

如果当前任务环境不允许备份，至少在回复中说明没有创建备份。

### 4.3 生成稳定 ID

AI 新建对象时应生成可读、稳定、低冲突的 ID。

推荐规则：

```text
table.id: snake_case 表名
column.id: snake_case 字段名
row._rowId: row_<table_id>_<序号或短随机串>
```

示例：

```json
{
  "id": "skill",
  "name": "Skill"
}
```

如果 ID 已存在，追加短后缀：

```text
skill
skill_2
skill_3
```

不要使用中文、空格、标点或展示名作为内部 ID。展示名放在 `name`。

### 4.4 新建一张表

新建表时追加到 `project.tables`。

最低要求：

```json
{
  "id": "skill",
  "name": "Skill",
  "position": { "x": 120, "y": 120 },
  "columns": [],
  "rows": []
}
```

推荐游戏配置表默认包含主键：

```json
{
  "id": "skill",
  "name": "Skill",
  "position": { "x": 120, "y": 120 },
  "columns": [
    {
      "id": "id",
      "name": "id",
      "type": "int",
      "required": true,
      "primary": true,
      "autoIncrement": true,
      "export": true
    }
  ],
  "rows": []
}
```

如果用户说明了字段，则按用户字段创建。没有说明时，不要凭空添加大量业务字段，可以只建主键和用户明确提到的字段。

### 4.5 新建多张表

批量新建时逐张创建，并让画布位置错开，避免节点重叠。

推荐布局：

```text
第 1 张：{ x: 120, y: 120 }
第 2 张：{ x: 460, y: 120 }
第 3 张：{ x: 800, y: 120 }
第 4 张：{ x: 120, y: 420 }
第 5 张：{ x: 460, y: 420 }
```

如果项目已有表，新表位置应避开已有表。可以从当前最大 `x` 或最大 `y` 之后开始。

批量新建时仍要保证：

- 每张表 `table.id` 唯一。
- 每张表内 `column.id` 唯一。
- 每行 `_rowId` 唯一。
- 引用关系指向已经存在或本次创建的目标表字段。

### 4.6 新建字段

把字段追加到目标表的 `columns`。

字段模板：

```json
{
  "id": "name",
  "name": "name",
  "type": "string",
  "export": true
}
```

字段类型默认值规则：

```text
int    -> 空值可用 ""，有数据时必须是整数 number
float  -> 空值可用 ""，有数据时必须是有限 number
string -> ""
bool   -> false
enum   -> enumValues[0] 或 ""
ref    -> 空值可用 ""，有数据时必须等于目标字段某个已有值
json   -> "{}" 或合法 JSON 值
```

给已有表新增字段时，必须同步给已有行补值：

```json
{
  "_rowId": "row_skill_1",
  "values": {
    "id": 1,
    "name": "Slash",
    "new_column_id": ""
  }
}
```

如果字段是 `bool`，补 `false`。如果字段是 `json`，补 `"{}"`。如果字段是 `enum`，优先补第一个枚举值。

### 4.7 更新字段

更新字段时优先修改字段对象，不要重建字段。

允许修改：

- `name`
- `type`
- `required`
- `primary`
- `autoIncrement`
- `export`
- `remark`
- `enumValues`
- `ref`

重要规则：

- 改字段显示名只改 `column.name`，不要改 `column.id`。
- 如果设置 `primary: true`，同一张表其他字段的 `primary` 应改为 `false`。
- 主键字段必须同时 `required: true`。
- `autoIncrement` 只适合 `type: "int"` 且 `primary: true` 的字段。
- 如果字段类型改为非 `ref`，应移除 `ref`。
- 如果字段类型改为非 `enum`，应移除 `enumValues` 或保持不使用。
- 改字段类型后，要检查已有 `row.values[column.id]` 是否还符合新类型。

### 4.8 新建或更新行数据

行数据在 `table.rows` 中。

新行模板：

```json
{
  "_rowId": "row_skill_1",
  "values": {
    "id": 1,
    "name": "Slash"
  }
}
```

行值规则：

- `values` 的 key 必须是 `column.id`。
- 每个已有字段都应该在 `values` 中有对应 key。
- `int` 和 `float` 用 JSON number，不要用字符串数字。
- `bool` 用 JSON boolean。
- `json` 可以用对象、数组、数字、字符串等合法 JSON 值；也可以用合法 JSON 字符串，例如 `"{}"`。
- `ref` 的值类型应和目标字段值类型一致。

如果主键字段 `autoIncrement: true`，新行 ID 推荐使用：

```text
最后一行主键数值 + 1
如果最后一行不是数字，则用表内最大数字 + 1
如果没有数字，则从 1 开始
```

### 4.9 设置引用字段

引用字段必须写成：

```json
{
  "id": "item_id",
  "name": "item_id",
  "type": "ref",
  "required": true,
  "export": true,
  "ref": {
    "tableId": "item",
    "columnId": "id"
  }
}
```

设置前必须确认：

- `ref.tableId` 对应表存在。
- `ref.columnId` 对应目标字段存在。
- 当前行里的引用值都能在目标表目标字段中找到。

示例：

```text
Drop.item_id -> Item.id
```

对应元数据：

```json
{
  "id": "item_id",
  "name": "item_id",
  "type": "ref",
  "ref": {
    "tableId": "item",
    "columnId": "id"
  }
}
```

### 4.10 设置 ID 注册表

如果用户希望某张表导出语言无关的 ID 注册表，设置 `table.identity`。

示例字段：

```text
key: string，例如 SOUND_CLICK
id: int，例如 1
```

表元数据：

```json
{
  "identity": {
    "namespace": "Sound",
    "keyColumnId": "key",
    "valueColumnId": "id"
  }
}
```

校验要求：

- `namespace` 不能为空。
- `keyColumnId` 必须指向存在字段。
- `valueColumnId` 必须指向存在字段。
- Key 值必须匹配 `^[A-Z][A-Z0-9_]*$`。
- Key 在表内不能重复。
- 运行时值在表内不能重复。
- `${namespace}.${key}` 在整个工程内不能重复。

### 4.11 批量更新每张表

当用户说“更新每个表”时，AI 应明确这是批量修改所有 `project.tables`。

常见批量任务：

- 给每张表增加字段。
- 给每张表主键开启 `autoIncrement`。
- 给每张表增加 `remark`。
- 统一设置 `export`。
- 补齐每行缺失字段。

批量更新原则：

- 只修改用户要求的字段。
- 不要重排表顺序，除非用户要求。
- 不要重建已有表、字段、行。
- 不要重写全部 ID。
- 不要删除未知字段。
- 不要把导出 JSON 的 key 反向写成 `row.values` 的 key。

示例：给每张表增加 `remark` 字段。

1. 遍历每张表。
2. 如果已有 `column.id === "remark"`，不要重复添加。
3. 如果没有，追加字段：

```json
{
  "id": "remark",
  "name": "remark",
  "type": "string",
  "export": true
}
```

4. 给每行 `values.remark` 补 `""`。

## 5. 写回前检查清单

写回 `.cfggraph.json` 前，AI 必须检查：

- 根对象仍是 `version: 1`。
- `tables` 仍是数组。
- 每张表 `id` 唯一且非空。
- 每张表 `name` 是字符串。
- 每张表 `position.x` 和 `position.y` 是数字。
- 每张表 `columns` 是数组。
- 每张表 `rows` 是数组。
- 每个字段 `id` 唯一且非空。
- 每个字段 `name` 是字符串，可以和 `id` 相同。
- 每个字段 `type` 属于：`int`、`float`、`string`、`bool`、`enum`、`ref`、`json`。
- 每个 `enum` 字段的 `enumValues` 是字符串数组。
- 每个 `ref` 字段有有效 `tableId` 和 `columnId`。
- 每行 `_rowId` 是字符串且唯一。
- 每行 `values` 是对象。
- 每行 `values` 使用字段 ID 做 key。
- 主键最多一个。
- 主键必须 `required: true`。
- `autoIncrement` 只用于 `int` 主键。
- 必填字段没有空值。
- `int` 值是整数 number。
- `float` 值是有限 number。
- `bool` 值是 boolean。
- `enum` 值在 `enumValues` 内。
- `ref` 值能在目标表目标字段找到。
- `json` 值可被合法 JSON 表达。

## 6. 写回格式

写回时使用格式化 JSON，推荐 2 空格缩进：

```ts
JSON.stringify(project, null, 2)
```

不要手工拼接 JSON。不要留下注释、尾逗号或无法解析的内容。

## 7. 完成后的反馈格式

AI 完成后应告诉用户：

- 修改了哪个工程文件。
- 新建或更新了哪些表。
- 新增、修改、删除了哪些字段。
- 是否设置了引用关系。
- 是否设置了 ID 注册表。
- 是否创建了备份。
- 是否运行了校验或构建命令。

示例：

```text
已更新 D:\project\godot\3\resource\json\game-config.cfggraph.json。
新增 3 张表：Item、Monster、Drop。
Drop.item_id 已引用 Item.id。
已创建备份 game-config.cfggraph.backup-20260713-153000.json。
```

## 8. 完整示例

用户需求：

```text
在 D:\project\godot\3\resource\json\game-config.cfggraph.json 里新建 Item 和 Drop 两张表。
Item 有 id、key、name。
Drop 有 id、item_id、count。
Drop.item_id 引用 Item.id。
Item 作为 ID 注册表，namespace 是 Item，key 字段是 key，value 字段是 id。
```

AI 应写入类似结构：

```json
{
  "version": 1,
  "tables": [
    {
      "id": "item",
      "name": "Item",
      "position": { "x": 120, "y": 120 },
      "columns": [
        {
          "id": "id",
          "name": "id",
          "type": "int",
          "required": true,
          "primary": true,
          "autoIncrement": true,
          "export": true
        },
        {
          "id": "key",
          "name": "key",
          "type": "string",
          "required": true,
          "export": true
        },
        {
          "id": "name",
          "name": "name",
          "type": "string",
          "required": true,
          "export": true
        }
      ],
      "rows": [],
      "identity": {
        "namespace": "Item",
        "keyColumnId": "key",
        "valueColumnId": "id"
      }
    },
    {
      "id": "drop",
      "name": "Drop",
      "position": { "x": 460, "y": 120 },
      "columns": [
        {
          "id": "id",
          "name": "id",
          "type": "int",
          "required": true,
          "primary": true,
          "autoIncrement": true,
          "export": true
        },
        {
          "id": "item_id",
          "name": "item_id",
          "type": "ref",
          "required": true,
          "export": true,
          "ref": {
            "tableId": "item",
            "columnId": "id"
          }
        },
        {
          "id": "count",
          "name": "count",
          "type": "int",
          "required": true,
          "export": true
        }
      ],
      "rows": []
    }
  ]
}
```

如果工程文件已有其他表，则不要替换整个 `tables` 数组，只追加或更新目标表。

