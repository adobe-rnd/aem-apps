# Schema Editor: agent notes

Before changing this app, read [docs/README.md](docs/README.md). It covers
the layering rules, the store and the bus. [docs/spec.md](docs/spec.md)
describes what gets saved, and [docs/recipes.md](docs/recipes.md) shows how to
extend the editor.

- Put logic in `core/`, which is pure and tested with `node --test`. Views in
  `ui/` only dispatch through the store.
- Never change the storage path or document shape. The da.live form editor
  and GraphQL read the same files.
- The SC subset is defined by
  [da-sc-sdk `docs/schema-spec.md`](https://github.com/adobe/da-sc-sdk/blob/main/docs/schema-spec.md).
- Verify every change with the commands in
  [Before you commit](docs/recipes.md#before-you-commit).
