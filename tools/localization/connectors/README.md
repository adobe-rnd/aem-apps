# Translation connectors

Connectors implementing the translation connector contract, apiVersion 1.

```js
import { createTranslationConnectors } from './connectors/index.js';
import { createTranslateProxy } from './connectors/host.js';

const translateProxy = createTranslateProxy({ fetch: actions.daFetch });
const translationConnectors = await createTranslationConnectors({
  name: 'google',
  settings: { simulatedDelayMs: 5000 },
  host: { translateProxy },
});

createLocalization({ org, actions, services: { translationConnectors } });

const { jobState } = await translationConnectors.call('send', { job, items });
const { langs } = await translationConnectors.call('getStatus', { jobState });
const { items, cursor } = await translationConnectors.call('getResults', { jobState, lang: 'fr-FR' });
```

- `supports(src, dest)` → boolean; `describe` is the descriptor; `call(method, args)` adds `settings` and the declared host services.
- `createTranslateProxy({ fetch, origin })`: only `origin` URLs (default `https://translate.da.live`); a plain-object `body` is sent as `FormData`; resolves `{ status, headers, body }`, JSON bodies parsed.

## Google

- Proxy: `POST {translateOrigin}/translate/google/{org}/{site}`, form fields `data`, `fromlang`, `tolang`; response `{ translated }`. HTML over 5000 chars is split after closing tags, never inside `translate="no"`.
- Formats: `html` only.
- `jobState` holds the source items and target codes; translation happens in `getResults` (paged by `resultsPageSize`, default 20).
- Settings: `simulatedDelayMs` (status `in-progress` until `sentAt + delay`), `translateOrigin`, `resultsPageSize`.
