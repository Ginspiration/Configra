# Game Config Graph Editor

Game Config Graph Editor is a blueprint-style table editor for game configuration data. It is designed for editing structured config tables, visualizing table references, validating data, and exporting runtime JSON.

The app currently runs as both a Vite web app and a local Tauri desktop app.

## Current Features

- React Flow canvas with draggable table nodes.
- Table-to-table arrows generated from `ref` fields.
- Left table list with click select and double-click edit.
- Glide Data Grid row editor in a modal.
- Table properties and field editor integrated into the row editor modal.
- Fullscreen row editor mode.
- Config fields with `int`, `float`, `string`, `bool`, `enum`, `ref`, and `json` types.
- Primary key, required, and auto-increment field flags.
- `ref` and `enum` cells edited with dropdowns.
- Multi-row and multi-cell selection in the grid.
- Paste text blocks into a column, one non-empty line per row.
- Row context menu: insert above, insert below, append, uppercase strings, copy row JSON, delete rows.
- Canvas/table context menus for create, edit, export, save/load, delete, and Mini Map toggle.
- Optional Mini Map.
- Chinese by default, with English language switcher.
- Validation for required values, types, primary keys, refs, enums, JSON, and ID Registry rules.
- Browser save/load of `.cfggraph.json`.
- Tauri desktop save/load to the current project file.
- Recent desktop project auto-load.
- Dirty-state protection before loading another project or closing the desktop app.
- Export selected table JSON.
- Export language-neutral `config_ids.json` ID Registry.

## Run

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run the desktop app:

```bash
npm run tauri:dev
```

Build the web app:

```bash
npm run build
```

Check the Tauri/Rust side:

```bash
cd src-tauri
cargo check
```

## First Screen

The app starts with a sample project containing:

- `Speaker`
- `Dialogue`

`Dialogue.speaker_id` references `Speaker.id`, so the canvas shows a relationship arrow:

```text
Dialogue.speaker_id -> Speaker.id
```

## Main Workflow

1. Create or select a table on the canvas.
2. Double-click a table node or table-list item to open the editor.
3. Edit table name, ID Registry settings, fields, and row data in the modal.
4. Set `ref` fields to target another table and field.
5. Fix validation issues shown in the editor.
6. Right-click a table to copy or export its JSON.
7. Right-click blank canvas space to save/load the project, create a table, toggle Mini Map, or export `config_ids.json`.

## Keyboard Shortcuts

- `Ctrl+S`: save project.
- `Ctrl+O`: load project.
- `Ctrl+N`: add table.
- `N`: add table.
- `R`: open selected table editor.
- `F`: add field to selected table.
- `C`: copy selected table JSON.
- `E`: export selected table JSON.
- `M`: toggle Mini Map.
- `Delete`: delete selected table.

Shortcuts are ignored while typing in inputs, textareas, selects, or editable controls.

## Row Editor

The row editor uses Glide Data Grid.

Editing behavior:

- Cells activate editing on double-click.
- `bool` fields render as booleans.
- `int` and `float` fields parse numeric input.
- `enum` fields use configured enum options.
- `ref` fields use options from the target table and target field.
- `json` fields accept valid JSON strings and export as parsed JSON when possible.
- Blank rows are available after existing rows; editing a blank row creates missing rows automatically.
- The primary key column is frozen when it is the first column.
- Column widths are stored in `localStorage` per table.

Paste behavior:

- Normal rectangular paste is supported.
- A single-column paste containing line breaks or blank rows is split into one non-empty trimmed line per row.

Right-click behavior:

- Insert row above.
- Insert row below.
- Append row.
- Uppercase string cells.
- Copy row or selected rows as JSON.
- Delete row or selected rows.

`Uppercase` only affects `string` cells. It is disabled for non-string targets.

## Data Model

Rows store values by stable column ID. Renaming a field changes `column.name`, not `column.id`.

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

Important ID rules:

- `table.id` is an internal stable ID.
- `column.id` is an internal stable ID.
- `row._rowId` is editor-only metadata.
- Exported table JSON uses `column.name || column.id` as keys.
- Exported table JSON never includes `_rowId`.

## ID Registry

Some game configs need both a code-facing key and a runtime ID:

```text
key             id      path
SOUND_CLICK      1      res://audio/click.wav
SOUND_WIN        2      res://audio/win.wav
```

Configure the table ID Registry:

```ts
identity: {
  namespace: 'Sound',
  keyColumnId: 'key',
  valueColumnId: 'id'
}
```

Exported `config_ids.json`:

```json
{
  "Sound.SOUND_CLICK": 1,
  "Sound.SOUND_WIN": 2
}
```

This format is language-neutral. Game code in any language can load the registry and resolve symbolic names to runtime IDs.

When a ref target table has ID Registry configured and the ref target field is the runtime ID field, ref dropdown labels show:

```text
SOUND_CLICK (1)
```

## Export Rules

Table JSON:

- Outputs an array.
- One object per row.
- Keys use field display names.
- `_rowId` and editor metadata are omitted.
- `json` field strings are parsed into JSON values when valid.

ID Registry JSON:

- Outputs one flat object.
- Keys are `${namespace}.${symbolKey}`.
- Values come from the configured runtime ID field.
- Rows with empty key or value are skipped.

## Save And Load

Browser mode:

- Save downloads `game-config.cfggraph.json`.
- Load uses a file picker and replaces the current project after validation.

Desktop mode:

- On startup, the app tries to load the last saved/opened project path.
- If no recent project exists, the sample project is shown.
- Save writes to the current project file.
- New projects without a file path open a save dialog on first save.
- Loading another project prompts when unsaved changes exist.
- Closing the app prompts when unsaved changes exist.

Tauri commands are implemented in `src-tauri/src/lib.rs`:

- `read_project_file`
- `write_project_file`
- `load_recent_project_path`
- `save_recent_project_path`

## Validation

The validator reports `ValidationIssue` records:

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

- Required fields cannot be empty.
- `int` values must be integers.
- `float` values must be finite numbers.
- `string` values must be strings.
- `bool` values must be booleans.
- `enum` values must be in `enumValues`.
- `json` values must be valid JSON values.
- `ref` values must exist in the target table/field.
- Each table can have at most one primary key field.
- Primary keys must be required, non-empty, and unique.
- Ref fields must have valid target table and target field.
- Empty enum option lists are warnings.
- ID Registry namespace cannot be empty.
- ID Registry key/value fields must be configured if identity is used.
- ID Registry keys must match `^[A-Z][A-Z0-9_]*$`.
- ID Registry keys and runtime values must be unique per table.
- ID Registry entries must be unique across the project.

## Source Layout

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

## Current Non-Goals

- AI-assisted editing.
- Undo/redo.
- CSV or Excel import.
- Multi-user collaboration.
- Plugin system.
- Complex export templates.
- Installer, auto-update, or release packaging polish.

The project should stay focused on the game-config editing loop: table schema, row data, references, validation, save/load, and JSON export.
