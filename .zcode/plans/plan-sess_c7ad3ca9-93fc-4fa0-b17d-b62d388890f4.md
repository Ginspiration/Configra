# 数据编辑器撤销/重做规划（含快捷键）

## 方案概要

按表维护快照式撤销/重做栈，实现在 `editorStore` 内。每次内容修改前对整张表做一次深拷贝快照（含 `name/remark/columns/rows/identity`，**不含 position**，画布拖动不可也不应被撤销），撤销时恢复快照并把当前状态压入重做栈。每栈上限 50 条。字段增删改、行增删移动、单元格编辑、粘贴、填充、大写转换、行导入全部可撤销；表的新建/删除和位置移动不在撤销范围内。

## store 改动（`src/store/editorStore.ts`）

1. 新增状态：`undoStacks: Record<tableId, UndoEntry[]>`、`redoStacks: Record<tableId, UndoEntry[]>`；`UndoEntry = { snapshot: TableSnapshot }`，`TableSnapshot` 为深拷贝的 `{ name, remark, columns, rows, identity }`（`structuredClone`）。
2. 新增内部助手 `captureUndo(state, tableId)`：从当前 `set` 回调的 `state` 取表做快照，返回要合并进本次 `set` 的 `{ undoStacks, redoStacks }` 增量（清空该表 redo 栈、裁剪到 50 条）；批量事务激活期间返回空对象。
3. 在以下 action 的 `set` 结果中合并 `...captureUndo(...)`（no-op 提前返回的放在判断之后）：`updateTable`（patch 含 position 以外的键才记）、`addColumn`、`updateColumn`、`moveColumn`、`deleteColumn`、`addRow`、`insertRow`、`moveRow`、`updateCell`、`deleteRow`、`deleteRows`、`appendRows`。`moveTable`/`selectTable`/`addTable`/`deleteTable` 不记录。
4. 新增 action：
   - `beginUndoBatch(tableId)` / `endUndoBatch()`：模块级事务标记，开头捕获一次快照，期间的 `captureUndo` 全部跳过。用于粘贴/填充/大写/多格编辑这类循环调用 `updateCell` 的复合操作，保证一次操作 = 一条撤销记录。组件侧 try/finally 包裹。
   - `undo(tableId)` / `redo(tableId)`：弹栈恢复（只还原快照字段，保留 position），互换 undo/redo 栈，并 `markDirty('content')` + `mergeDirtyTableIds`。
5. 栈清理：`deleteTable` 删除对应两栈；`loadProject`/`newProject`/`reloadProject` 清空全部（外部 AI/CLI 改盘重载后不允许撤销到旧内存状态）。

## 行编辑器接线（`src/dataGrid/DataGridModal.tsx` + `gridShortcuts.ts`）

1. `resolveGridShortcut` 扩展 `'undo' | 'redo'`：`Ctrl/Cmd+Z`（无 Shift）撤销；`Ctrl/Cmd+Shift+Z` 或 `Ctrl/Cmd+Y` 重做；Alt 组合排除。已确认 Glide 默认键绑定无撤销，`cancel()` 可安全接管。
2. `onGridKeyDown` 处理 undo/redo（网格聚焦时）。已有的 Esc 窗口监听旁新增一个 window 级监听：窗口前台且焦点不在 `input/textarea/select` 时也响应（保护输入框的原生文本撤销不被抢占）。
3. 标题栏 actions 区新增"撤销/重做"按钮，用 `undoStacks[table.id]?.length` 选择器做禁用态。
4. 复合操作包事务：`applyCellEdits`（含多格编辑/删除清空）、`onPaste`、`onFillPattern`、`uppercaseCells`。

## i18n、快捷键面板与文档

- `src/i18n.ts`：`undo`（撤销/Undo）、`redo`（重做/Redo）。
- `src/help/ShortcutCheatSheet.tsx`：行编辑器分组补 `Ctrl+Z`、`Ctrl+Shift+Z / Ctrl+Y` 两条。
- `AGENTS.md`：第 5 节补撤销/重做行为；第 11 节补新 action 与快照/清理语义；第 12 节补新键位；第 17 节"当前不做的内容"移除"撤销/重做"；第 18 节移除已完成的"基于 store patch 增加撤销/重做"。

## 测试

`src/dataGrid/gridShortcuts.test.ts` 补 undo/redo 键位分支；`src/store/editorStore.test.ts` 按现有风格补：单元格修改 undo/redo 往返、删行 undo、事务内多次 updateCell 只记一条、`moveTable`/相同值 `updateCell` 不产生记录、`deleteTable` 与 `reloadProject` 清栈。

## 不做的事

- 不做画布位置、表新建/删除的撤销；不做跨表全局撤销栈；不做 MCP/CLI patch 层的撤销。
- 撤销不显示操作标签文案，仅按钮 + 键位。

## 验证

1. `npm run build`、`npm test`。
2. `npm run dev` 浏览器实测：改单元格 → Ctrl+Z 还原 → Ctrl+Shift+Z 重做；粘贴多格一次 Ctrl+Z 全部回退；焦点在表名输入框时 Ctrl+Z 走输入框原生撤销；标题栏聚焦时 Ctrl+Z 撤销表格；按钮禁用态随栈深变化；Esc/遮挡守卫等既有行为不回归。
