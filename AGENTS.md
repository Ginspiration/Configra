# Game Config Graph Editor Development Notes

This document is the handoff guide for AI agents and developers working in this repository.

The repository is now an independent Vite + React + TypeScript + Tauri project. It is not the old Godot game project. Keep this tool focused on game configuration editing, not general spreadsheet replacement.

## 1. Product Goal

Build a blueprint-style table editor for game configuration data.

The core loop is:

```text
Create table
Create fields
Edit rows
Set field reference relations
Visualize table relations with arrows
Validate data
Export per-table JSON
Export language-neutral ID registry JSON
Save/load project file
```

The tool is not Excel. It should stay optimized for structured game config tables, stable internal IDs, references, validation, and export.

AI features are intentionally not implemented yet. If added later, AI should generate patches, show diffs, wait for user confirmation, apply changes, and re-run validation.

## 2. Current Implementation Summary

Current stack:

```text
Vite
React
TypeScript
React Flow
Zustand
Glide Data Grid
Tauri
```

Current app shape:

```text
Top toolbar: save / load / Mini Map / language
Left panel: table list
Center: React Flow blueprint canvas
Modal editor: table properties + fields + issues + Glide Data Grid rows
Context menus: table, canvas, and grid row/cell actions
```

The project currently supports both:

- Web mode via `npm run dev`
- Desktop mode via `npm run tauri:dev`

## 3. Step-By-Step Goal Comparison

This section tracks the original MVP target against current behavior.

| Step | Original target | Current status | Main files |
| --- | --- | --- | --- |
| 1 | Create Vite + React + TypeScript app | Done | `package.json`, `vite.config.ts`, `src/main.tsx` |
| 2 | Install React Flow and Zustand | Done | `package.json`, `src/graph/*`, `src/store/editorStore.ts` |
| 3 | Define data model and sample project | Done, extended with `identity` and `autoIncrement` | `src/model/types.ts`, `src/model/sampleProject.ts` |
| 4 | Implement Zustand store | Done, includes dirty state, insert/delete multiple rows, auto-increment rows | `src/store/editorStore.ts` |
| 5 | Implement base layout | Done, simplified to toolbar + table list + canvas + modal editor | `src/App.tsx`, `src/styles/app.css` |
| 6 | Render table nodes in React Flow | Done | `src/graph/GraphCanvas.tsx`, `src/graph/TableNode.tsx` |
| 7 | Drag table nodes and save positions | Done; position updates during drag and drag stop | `src/graph/GraphCanvas.tsx`, `src/store/editorStore.ts` |
| 8 | Generate arrows from `ref` fields | Done | `src/graph/graphMapping.ts` |
| 9 | Select tables | Done by table list, node click, and context menu | `src/App.tsx`, `src/graph/GraphCanvas.tsx` |
| 10 | Edit table and fields | Done inside modal side panel | `src/inspector/TableInspector.tsx`, `src/inspector/ColumnEditor.tsx` |
| 11 | Edit row data | Done with Glide Data Grid modal | `src/dataGrid/DataGridModal.tsx` |
| 12 | Add tables, fields, rows | Done via shortcuts, right-click menus, editor buttons, and blank grid rows | `src/App.tsx`, `src/store/editorStore.ts`, `src/dataGrid/DataGridModal.tsx` |
| 13 | Validate data | Done, extended with ID Registry checks | `src/validation/validateProject.ts` |
| 14 | Export current table JSON | Done by table right-click and keyboard shortcut | `src/App.tsx`, `src/export/exportTables.ts` |
| 15 | Save/load project file | Done in browser and desktop modes | `src/App.tsx`, `src/file/projectFile.ts`, `src/file/desktopProjectFile.ts`, `src-tauri/src/lib.rs` |
| 16 | Simple UI polish | Done; compact editor-style UI | `src/styles/app.css` |
| 17 | Language selector | Done, default Chinese | `src/i18n.ts`, `src/App.tsx` |
| 18 | Optional Mini Map | Done | `src/App.tsx`, `src/graph/GraphCanvas.tsx` |
| 19 | Keyboard shortcuts | Done | `src/App.tsx` |
| 20 | Desktop recent project and dirty-close guard | Done | `src/App.tsx`, `src/file/desktopProjectFile.ts`, `src-tauri/src/lib.rs` |
| 21 | ID Registry for code/config bridge | Done | `src/model/types.ts`, `src/inspector/TableInspector.tsx`, `src/export/exportTables.ts`, `src/validation/validateProject.ts` |

## 4. Current UI Behavior

### Toolbar

Toolbar contains:

- Save
- Load
- Mini Map toggle
- Language selector

Default language is Chinese. English is available through the selector.

### Table List

Left table list behavior:

- Click selects a table.
- Double-click opens row editor modal.
- Right-click opens the same table context actions as canvas table nodes.

### Canvas

React Flow canvas behavior:

- Nodes show table name and field list.
- Nodes show `PK`, `AI`, required marker, and `ref` target label.
- Dragging a node updates table position.
- Double-clicking a node opens the editor modal.
- Right-clicking a node opens table actions.
- Right-clicking blank canvas opens canvas/project actions.
- Optional Mini Map can be toggled.

### Context Menus

Table context menu:

- Edit
- Copy Table JSON
- Download JSON
- Delete Table

Canvas context menu:

- New Table Here
- Save
- Load
- Copy ID Registry
- Download ID Registry
- Toggle Mini Map

Grid context menu:

- Insert row above
- Insert row below
- Append row
- Uppercase string cells
- Copy row or selected rows as JSON
- Delete row or selected rows

Native browser context menus are suppressed except inside inputs, textareas, selects, and editable controls.

## 5. Row Editor Details

Rows are edited in `src/dataGrid/DataGridModal.tsx` with Glide Data Grid.

Important behavior:

- The editor opens as a modal.
- Table properties, ID Registry settings, fields, and issues are integrated into the modal side panel.
- Fullscreen mode is supported.
- Close button is an `X`.
- Search uses Glide search and focuses matching cells.
- Cells activate editing on double-click.
- `editOnType` is disabled.
- Row markers are clickable numbers.
- Multi-row and multi-rect selection are enabled.
- Fill handle is enabled.
- Smooth scroll is enabled.
- Primary key column is frozen if it is the first column.
- Extra blank rows are displayed after existing rows; editing blank rows creates rows.
- Column widths are persisted in `localStorage` per table.

Cell behavior:

- `bool` maps to Glide boolean cells.
- `int` and `float` map to number cells.
- `enum` and `ref` map to custom dropdown cells.
- `json` maps to markdown-like text editing and is parsed on export when valid.
- Invalid cells are highlighted through issue-derived theme overrides.

Paste behavior:

- Normal rectangular paste is applied from the target cell.
- Single-column text with line breaks or blank rows is split into one trimmed non-empty line per row.
- Pasting beyond existing rows creates rows.
- Pasted values are parsed by column type.

Uppercase behavior:

- Only string cells are uppercased.
- If right-clicking inside a selected range, all string cells in that range are uppercased.
- If right-clicking inside selected rows, all string cells in those rows are uppercased.
- Otherwise only the right-clicked string cell is uppercased.
- The menu item is disabled when no target string cell exists.

## 6. Data Model

Current model lives in `src/model/types.ts`.

```ts
export const COLUMN_TYPES = ['int', 'float', 'string', 'bool', 'enum', 'ref', 'json'] as const;

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
  type: ColumnType;
  required?: boolean;
  primary?: boolean;
  autoIncrement?: boolean;
  enumValues?: string[];
  ref?: ColumnRef;
};

export type ConfigRow = {
  _rowId: string;
  values: Record<string, unknown>;
};
```

Important rules:

- `table.id` is an internal stable ID.
- `column.id` is an internal stable ID.
- Renaming a field changes `column.name`, not `column.id`.
- Row values are stored by `column.id`.
- `_rowId` is editor metadata and is not exported.
- Exported table JSON uses `column.name || column.id`.

## 7. ID Registry

ID Registry bridges code-facing symbolic names and runtime config IDs without generating language-specific constants.

Example table:

```text
key             id      path
SOUND_CLICK      1      res://audio/click.wav
SOUND_WIN        2      res://audio/win.wav
```

Table identity:

```json
{
  "namespace": "Sound",
  "keyColumnId": "key",
  "valueColumnId": "id"
}
```

Exported `config_ids.json`:

```json
{
  "Sound.SOUND_CLICK": 1,
  "Sound.SOUND_WIN": 2
}
```

This is intentionally language-neutral. Game code can load the JSON registry and resolve names in C#, GDScript, Lua, JavaScript, C++, or other languages.

Ref dropdown labels use identity information when possible:

```text
SOUND_CLICK (1)
```

That display happens when the referenced target column is the table identity `valueColumnId`.

## 8. Export Rules

Implemented in `src/export/exportTables.ts`.

Table export:

- Exports one table as a JSON array.
- Each row becomes one object.
- Keys are `column.name || column.id`.
- `_rowId`, positions, column metadata, and editor metadata are omitted.
- Valid string JSON in `json` fields is parsed before export.

ID Registry export:

- Exports one flat JSON object.
- Key format is `${namespace}.${symbolKey}`.
- Value is the configured runtime ID column value.
- Rows with empty key or empty value are skipped.
- Browser mode downloads `config_ids.json`.
- Desktop mode asks for a save path and writes the file.

## 9. Validation Rules

Implemented in `src/validation/validateProject.ts`.

Validation issues use:

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

Implemented checks:

- Unnamed fields are errors.
- More than one primary key field is an error.
- Primary key fields must be required.
- Primary key values cannot be empty.
- Primary key values cannot duplicate.
- Empty enum option lists are warnings.
- Ref fields must have target table and target field.
- Ref target table and field must exist.
- Required fields cannot be empty.
- `int` values must be integers.
- `float` values must be finite numbers.
- `string` values must be strings.
- `bool` values must be booleans.
- `enum` values must be in `enumValues`.
- `json` values must be valid JSON values.
- `ref` values must exist in the target table/field.
- ID Registry namespace cannot be empty.
- If identity is configured, key and value fields must exist.
- ID Registry key values cannot be empty.
- ID Registry key values must match `^[A-Z][A-Z0-9_]*$`.
- ID Registry key values cannot duplicate within a table.
- ID Registry runtime values cannot be empty.
- ID Registry runtime values cannot duplicate within a table.
- ID Registry entries cannot duplicate across the project.

## 10. Save And Load

### Browser Mode

Browser mode behavior:

- Save downloads `game-config.cfggraph.json`.
- Load uses a hidden file input.
- The chosen file is parsed and structurally validated before replacing the project.
- Unsaved changes prompt before loading another file.

### Desktop Mode

Desktop mode behavior:

- Uses Tauri file dialogs and Rust commands.
- On startup, tries to load the remembered recent project path.
- If no recent project exists, starts with the sample project.
- Save writes to the current project path.
- If no path exists, save opens a save dialog.
- Opening another project prompts when there are unsaved changes.
- Closing the app prompts when there are unsaved changes.
- "Save and Quit" saves first, then destroys the app window.

Tauri commands in `src-tauri/src/lib.rs`:

- `read_project_file(path)`
- `write_project_file(path, text)`
- `load_recent_project_path()`
- `save_recent_project_path(path)`

Recent project path is stored in the app config directory as `recent-project.txt`.

## 11. Store Behavior

Implemented in `src/store/editorStore.ts`.

Store contains:

- `project`
- `selectedTableId`
- `isDirty`

Actions:

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

Dirty-state behavior:

- Mutating actions mark the project dirty.
- Loading a project marks clean.
- Saving marks clean.
- Selection alone does not mark dirty.
- Small sub-pixel table movement is ignored by `samePosition`.

Auto-increment behavior:

- A column can auto-increment only when it is both `primary` and `int`.
- New rows use last row value + 1 when possible.
- If the last row value is not numeric, uses max numeric value + 1.
- If no numeric values exist, starts at `1`.
- IDs remain editable by the user.

## 12. Keyboard Shortcuts

Implemented in `src/App.tsx`.

Global shortcuts:

- `Ctrl+S`: save project.
- `Ctrl+O`: load project.
- `Ctrl+N`: add table.
- `S`: save project.
- `O`: load project.
- `N`: add table.
- `R`: open selected table editor.
- `F`: add field to selected table.
- `C`: copy selected table JSON.
- `E`: download selected table JSON.
- `M`: toggle Mini Map.
- `Delete`: delete selected table.

Shortcuts do not run when the event target is inside:

- `input`
- `textarea`
- `select`
- `[contenteditable="true"]`

## 13. Internationalization

Implemented in `src/i18n.ts`.

Languages:

- `zh`
- `en`

Default language is `zh`.

When adding UI text:

1. Add the English key first to the `en` object.
2. Add the matching Chinese translation in `zh`.
3. Use the `Translator` type in components.
4. Do not hardcode new visible UI text unless it is non-localized technical content.

## 14. Source Layout

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

## 15. Coding Guidelines For Future Agents

Follow these rules when editing this project:

- Preserve stable IDs in project data.
- Do not key row values by display name.
- Do not put full row data inside React Flow nodes.
- Keep graph nodes focused on table structure.
- Prefer extending existing store actions over local ad-hoc state mutations.
- Keep validation centralized in `validateProject.ts`.
- Keep export logic centralized in `exportTables.ts`.
- Keep file parsing and structural validation in `projectFile.ts`.
- Keep Tauri filesystem calls behind `desktopProjectFile.ts`.
- Do not add language-specific constant generation unless the user explicitly asks; prefer language-neutral JSON first.
- Do not add broad spreadsheet features unless they serve game config editing.
- Do not silently introduce commercial-license UI/data-grid dependencies.
- Do not implement AI features directly against store mutation; use patch/diff/confirm/apply if added later.

## 16. Verification Commands

After code changes, run:

```bash
npm run build
```

For Tauri/Rust changes or desktop file behavior:

```bash
cd src-tauri
cargo check
```

For UI behavior changes, also run a local app and test the relevant workflow:

```bash
npm run dev
```

or:

```bash
npm run tauri:dev
```

Known build warnings:

- Vite/Rollup may warn about `/*#__PURE__*/` annotations inside Glide Data Grid dependencies.
- Vite may warn that the main chunk is larger than 500 kB.

These warnings currently do not block builds.

## 17. Current Non-Goals

Do not treat these as expected current features:

- AI generation or AI editing.
- Undo/redo.
- CSV/Excel import.
- Multi-user collaboration.
- Plugin system.
- Complex export templates.
- Release packaging polish.
- Auto-update.
- Permission system.
- Full spreadsheet formula engine.

## 18. Future Work Ideas

Reasonable next steps:

- Add undo/redo around store patches.
- Add import from JSON sample to infer table schema.
- Add bulk find/replace in selected string cells.
- Add duplicate-row action.
- Add explicit all-table export.
- Add export directory configuration in desktop mode.
- Add test coverage for export and validation pure functions.
- Add optional code generation as a separate export layer if the user later wants language-specific constants.

Keep the minimum loop stable before expanding: schema, rows, refs, validation, save/load, export.
