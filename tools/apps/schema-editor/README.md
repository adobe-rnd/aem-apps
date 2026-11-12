# Schema Editor

A visual editor for Document Authoring **Structured Content** schemas. Authors
build a schema by dragging elements (text, choice, number, date, group, list,
reusable components…) onto a canvas and setting their options in a tool panel.
The editor writes plain JSON Schema, limited to the subset Structured Content
supports (see the `da-sc-sdk` schema spec).

```
https://da.live/app/adobe-rnd/aem-apps/tools/apps/schema-editor/schema-editor#/{org}/{site}
```

## How to use

### Browse (`#/{org}/{site}`)

Lists the site's schemas with their field count, components and issues.
Search, sort, and use a row's menu to open, duplicate, copy the JSON or delete.
**New schema** starts from a blank schema or from pasted JSON.

### Author (`#/{org}/{site}/{name}`)

- **Build**: the schema as nested cards, each led by its type icon, with
  its element and constraints at a glance. Drag cards to reorder or move
  them between groups; a blue hint on the insertion line or the highlighted
  item tells what the drop does (Insert here, Move here, Replace). Select a
  card to edit it. A component used as a field
  wears the component colour, indigo, on its icon and the line along its
  fields; its type reads `Component: Address · used in 2 cases` (a narrow canvas
  drops the part after the dot). Its own settings (label, key, required…)
  are edited here, but its fields are only a preview: folded at first,
  greyed out and locked (with a lock icon), without menus or dragging.
  The Expand all switch above the tree opens them
  too. A component is edited only on the Components
  page: **Edit component** in the use's menu, double-clicking the use, or
  double-clicking (or Enter on) one of its fields opens it there, with that
  field selected. Fields move only within their own tree, never into or out
  of a component: a drag over a use's fields outlines them in orange, with
  "Address is a component. Edit it on the Components page." A component can't contain itself, directly or through
  others: forms can't render recursive schemas. On a narrow canvas (beside the chat), a card keeps
  only its Required and Read-only flags and counts the rest ("+2"); hover the
  count for the full list.
- **Components**: one component (`$defs`) at a time, as an editable tree in
  the same cards, so a component can use other components. The Components
  panel, the first tab on this page and brought forward on arriving here,
  switches component and starts a new one with **New component**. With none
  yet, the page explains what a component is and offers the same **New
  component**. Opening a component from anywhere (the panel, an issue in an unused
  component) shows it here; switching here with a use selected in Build
  shows its component, otherwise the last one shown.
- **Tool panel** (right): 320–400px wide, following the window; below 720px it
  overlays the canvas, under the header so Save and Undo stay in reach.
  - **Elements**: drag an element onto the schema to add it; clicking one
    adds nothing (with the keyboard, Enter adds it at the selection).
  - **Properties**: the selected element, as settings or as JSON (the view
    switch in the header's corner). **Settings**: label, key, description,
    required, and its options (length, pattern, range, choices, list
    limits…); a field of a component says which component it belongs to,
    and a component lists where it is used, each a link back to that use.
    **JSON**: its JSON as saved, with a copy button. A component use is
    saved as a reference (`$ref`), so it shows the reference and then the
    component's JSON.
    Clicking or editing an element on the canvas brings Properties forward.
  - **Components**: reusable definitions (`$defs`) and in how many cases each
    is used; opening one shows it on the Components page, where the one shown
    is highlighted. Use one as a field from Elements. The first tab on the
    Components page; not offered in Build, which has the Components page.
  - **Issues**: everything the editor or the SC SDK flags, with quick fixes.
- **Build / Components**: the header's pages. The whole file's JSON is the
  schema's own Properties › JSON (click the title to select it).
- Undo / redo (⌘Z / ⇧⌘Z) and Save (⌘S). Saving is blocked while there are errors.
- The header and the tool panel use the da.live canvas chrome: a fixed 48px bar
  that never wraps, the panel's close button and the header's reopen toggle in
  the same spot, so opening or closing the chat or the panel moves nothing.

### AI assistant

When the shell offers the DA chat to the app, the editor adds:

- **Chat toggle** (top-left of the header, as in the da.live canvas): opens the
  chat with the schema as context (and the unsaved draft, if any).
  Hidden while the chat is open on shells that report panel visibility
  (`capabilities.panelVisibility`), so only the chat's own close button shows.
- **Fix with AI** (Issues): sends the issues and the draft to the assistant.
- **New schema → With AI…** (browse): asks the assistant to create a schema.

After each completed assistant turn, the editor reloads the schema (the change
can be undone) and browse reloads its list. The chat is only available when the
app runs as a site app (`/app/{org}/{site}/…` matching the context) with the EW
chat enabled; otherwise these actions are hidden.

## Storage

Schemas are stored as DA documents, one per schema, compatible with the
previous schema editor:

```
/{org}/{site}/.da/forms/schemas/{name}.html
```

The JSON Schema sits in a code block of the document (`core/codeblock.js`).

## Architecture

The code has three layers:

- **`core/`** holds all the logic. It is pure (no DOM, no network) and unit
  tested.
- **`adapters/`** talk to DA, the SC SDK and the shell.
- **`ui/`** holds the Lit views. They dispatch commands to one `SchemaStore`
  and have no editing rules of their own.

Start with the [developer guide](docs/README.md). It covers the mental model
and the rules. The [spec](docs/spec.md) covers the model, the JSON Schema
mapping, validation and storage. [Recipes](docs/recipes.md) explain how to
extend the editor.

### Dependencies

- [nx2](https://github.com/adobe/da-nx/tree/main/nx2) shared components and
  styles, loaded from `da.live`.
- The Structured Content SDK: `https://da.live/nx/deps/da-sc-sdk/dist/index.js`
  (validation).
- The DA app SDK: `https://da.live/nx/utils/sdk.js` (token, context, chat).

## Development

```sh
npx eslint tools/apps/schema-editor test/tools/apps/schema-editor
npx stylelint "tools/apps/schema-editor/**/*.css"
node --test "test/tools/apps/schema-editor/**/*.test.js"
```

Run `aem up` and open the app with `?ref=local&nxver=2`:

```
https://da.live/app/adobe-rnd/aem-apps/tools/apps/schema-editor/schema-editor?ref=local&nxver=2#/{org}/{site}
```
