# Game Config Graph Editor

A blueprint-style table editor for game configuration data.

First version scope:

- Edit multiple draggable config tables on a React Flow canvas.
- Define fields with type, required, primary key, enum values, and ref targets.
- Edit rows with type-aware HTML controls.
- Render `ref` fields as table-to-table arrows.
- Validate required values, primary keys, refs, enums, JSON, and basic types.
- Save/load `.cfggraph.json` project files.
- Copy or download the selected table as JSON.

## Run

```bash
npm install
npm run dev
```

The app starts with a sample `Speaker` and `Dialogue` project. `Dialogue.speaker_id` references `Speaker.id`, so the canvas should show an arrow between those tables.

## Build

```bash
npm run build
```

## Project File

Browser save/load uses the complete `ProjectFile` JSON shape:

```ts
type ProjectFile = {
  version: 1;
  tables: ConfigTable[];
};
```

Rows store values by stable column ID. Exported table JSON uses field display names and omits editor metadata such as `_rowId`.
