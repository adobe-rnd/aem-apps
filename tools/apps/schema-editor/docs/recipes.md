# Schema Editor: recipes

How to extend the editor without breaking its layering (see the
[rules](README.md#rules)). Put the logic in `core/` and test it with
`node --test`. Keep the views in `ui/` thin.

## Add an element

1. **Describe it** in `ELEMENTS` (`core/model/elements.js`):
   - `kind`, and for strings a `variant`.
   - `class`: elements of one class hold compatible values. Switching to
     another class asks the author to confirm first.
   - `palette` section, `icon`, `label`, `description`.
   - `sections`: the Properties sections it shows.

   The palette, Change element and new nodes all read this table.
2. **Map a new variant or keyword** both ways:
   - JSON → model: `stringVariant` and `modelledKeywords` in `parse.js`.
   - Model → JSON: `serialize.js`.
   - Keyword missing from `modelledKeywords`? It survives as an extra but
     can't be edited.
3. **Carry its fields across element changes:**
   - Add them to `ELEMENT_FIELDS`.
   - Handle them in `changeElement` (`commands.js`).
4. **Map its icon** in `FILES` (`ui/shared/icons.js`). The S2 SVG goes in
   `ui/img/icons/`.
5. **Test the round trip** in `core/model/parse-serialize.test.js`:
   JSON → model → JSON must give back the same JSON.

Check the [SC schema spec](https://github.com/adobe/da-sc-sdk/blob/main/docs/schema-spec.md)
first: the editor must not write anything the SDK rejects.

## Add a setting to Properties

1. **Write a section** in `ui/panel/sections/`, a function
   `(ctx) => section(id, label, template)`.
   - Build it from the controls in `controls.js`.
   - `ctx.update(patch)` dispatches `updateNode` and gives you undo.
   - `ctx.error(field)` shows that field's lint error inline.
2. **Register it** in `SECTIONS` (`sections/index.js`) and list its id in the
   elements that show it.
3. **Validate the value in lint, not in the control.** Inconsistent values are
   applied and flagged, never rejected.

## Add a lint rule

- **Add a check** in `lintNode` in `core/model/lint.js`: call
  `report(code, severity, message, { field, fix })`.
  - `field` ties the issue to a control, so it shows inline.
  - `fix` is `{ label, run: (model) => someCommand(model, args) }`.
  - Rules about components go in the `defs` loop of `lint`.
- **Severity:**
  - `error`: the SDK would reject it, or content would break. Blocks saving.
  - `warning`: it saves, but probably isn't what the author wants.
  - `info`: a style hint.
- **Test it** in `core/model/lint.test.js`.

## Add an edit (command)

1. **Write a pure function** in `core/model/commands.js`:
   `(model, args) → { model, label, coalesceKey? }`.
   - Copy only the path you change.
   - Return the same `model` when nothing changes.
   - Throw `CommandError` to refuse the edit, with a message for the author.
2. **Call it** from `ui/shared/actions.js`, which holds the user intents shared
   by the canvas, the panel and the keyboard, or from a section through
   `ctx.dispatch`.
3. **Test it** in `core/model/commands.test.js`.

## Add a drop rule

- **Where a drop may land** (targets, cycles, component boundaries):
  `core/dnd/targets.js`, a pure function.
- **Finding the zone under the pointer:** `ui/author/drop-target.js`.

## Add an event

1. **Add a channel** to `createSchemaBus` (`core/session/bus.js`), with a
   JSDoc comment describing its payload.
2. **Name it by what it carries:**
   - `fooState` is a broadcast: `createChannel({ replay: true })`.
   - `fooRequest` is a command: `createChannel()`.
3. **Emit it** from the store or an action.
4. **Subscribe** in Lit views through `BusController`. Its subscribe function
   returns the unsubscribe handles.

Don't add DOM `CustomEvent`s or a second observable for in-session signals.

## Add a panel view

1. **Create the view:** a Lit element that extends `PanelView`
   (`ui/panel/panel-view.js`). It receives `.store` and gets `model`, `issues`,
   `selection` and `page` from the bus.
2. **Register it** in `VIEWS` (`ui/panel/views.js`):
   - Give it a lazy `load`.
   - Use `hiddenIn` for the pages it doesn't apply to.
   - Implement `applyRequest(request)` if a `panelRequest` should configure it.

## Before you commit

```sh
node --test "test/tools/apps/schema-editor/**/*.test.js"
npx eslint tools/apps/schema-editor test/tools/apps/schema-editor
npx stylelint "tools/apps/schema-editor/**/*.css"
npm run license:check
```

Then check the change in the running app (`aem up`, then `?ref=local&nxver=2`),
both with the chat open and with it closed.
