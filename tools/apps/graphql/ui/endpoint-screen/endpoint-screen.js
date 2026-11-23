/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable no-underscore-dangle, import/no-unresolved */
import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { showToast, VARIANT_ERROR } from 'https://da.live/nx2/blocks/shared/toast/toast.js';
import { core } from '../../adapters/index.js';
import { NO_SCHEMAS_MESSAGE } from '../../core/endpoint.js';
import { getSchemaEditorHref } from '../utils/route.js';
import { endpointSaved } from '../utils/messages.js';
import {
  createDraft, getSaveBlocker, getSaveState, isDirty, selectSchemas,
} from './helpers/draft.js';
import { getSchemaOptions } from '../schemas-panel/helpers/options.js';
import { canvasStyle } from '../shared/canvas/canvas.js';
import { headerStyle, renderHeader } from '../header/header.js';
import {
  inlineAlertStyle, renderInlineAlert, renderReadOnlyAlert,
} from '../shared/inline-alert/inline-alert.js';
import { messageStyle, renderLoading } from '../shared/message/message.js';
import { renderStatusLight, statusLightStyle } from '../shared/status-light/status-light.js';
import 'https://da.live/nx2/blocks/shared/search/search.js';
import 'https://da.live/nx2/blocks/shared/segmented-btn/segmented.js';
import '../schemas-panel/schemas-panel.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-endpoint-screen';

// The bar's view switch, as in the schema editor.
const TABS = [
  { value: 'schemas', label: 'Schemas' },
  { value: 'graphql', label: 'GraphQL SDL' },
];

const RESAVE_TITLE = 'Regenerate the SDL from the current schemas, then save and publish it again';
const HOLD_SHIFT_TITLE = 'No unsaved changes. Hold Shift to resave';
// Pointer events carry Shift too, for when the canvas frame doesn't have the keyboard focus.
const SHIFT_EVENTS = ['keydown', 'keyup', 'pointermove', 'blur'];

// One endpoint's screen; `isNew` starts an unsaved endpoint called `name`. The bar holds the
// tabs, the Schemas search and the save actions; the tab panel scrolls under it.
// Emits `change-site`, `endpoints-change` (after creating) and `route-change`.
class EndpointScreen extends LitElement {
  static properties = {
    site: { attribute: false },
    name: { type: String },
    isNew: { type: Boolean },
    _config: { state: true },
    _draft: { state: true },
    _schemas: { state: true },
    _busy: { state: true },
    _tab: { state: true },
    _query: { state: true },
    _shift: { state: true },
  };

  constructor() {
    super();
    this._tab = 'schemas';
    this._query = '';
    this._shift = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [
      buttonStyle, canvasStyle, headerStyle, inlineAlertStyle, messageStyle, statusLightStyle,
      style,
    ];
    SHIFT_EVENTS.forEach((type) => window.addEventListener(type, this.trackShift));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    SHIFT_EVENTS.forEach((type) => window.removeEventListener(type, this.trackShift));
  }

  // Holding Shift enables a saved endpoint's Save without changes, to resave it.
  trackShift = (event) => {
    this._shift = !!event.shiftKey;
  };

  get saveState() {
    return getSaveState({
      draft: this._draft,
      blocker: this.blocker,
      dirty: this.dirty,
      busy: !!this._busy,
      shift: this._shift,
    });
  }

  get dirty() {
    return isDirty({ draft: this._draft, config: this._config });
  }

  get blocker() {
    return getSaveBlocker({
      draft: this._draft, preview: this._preview, existing: this.site.endpoints,
    });
  }

  willUpdate(props) {
    if (props.has('site') || props.has('name')) this.load();
    if (!['_draft', '_schemas', '_config'].some((prop) => props.has(prop))) return;
    const draft = this._draft;
    this._preview = draft
      ? this._sdlModule.buildSdl({ schemaIds: draft.schemas, schemas: this._schemas })
      : undefined;
    this._options = draft
      ? getSchemaOptions({ draft, schemas: this._schemas, saved: this._config?.schemas })
      : [];
  }

  navigate(route) {
    this.dispatchEvent(new CustomEvent('route-change', { detail: { route, replace: true } }));
  }

  async confirm(request) {
    await import('../shared/confirm/confirm.js');
    return this.shadowRoot.querySelector('gql-confirm').ask(request);
  }

  async load() {
    const { org, site } = this.site;
    const key = `${org}/${site}/${this.name}`;
    if (key === this._key) return;
    this._key = key;
    this._config = undefined;
    this._draft = undefined;
    const [result, loaded, sdlModule] = await Promise.all([
      this.isNew ? {} : core.loadEndpoint({ org, site, name: this.name }),
      core.loadSchemas({ org, site }),
      import('../../core/sdl.js'),
    ]);
    if (key !== this._key) return;
    const failed = [result, loaded].find(({ error }) => error);
    if (failed) {
      showToast({ text: failed.error, variant: VARIANT_ERROR });
      this.navigate({ org, site });
      return;
    }
    this._sdlModule = sdlModule;
    this._schemas = loaded.schemas;
    this._config = result.config;
    this._draft = createDraft({ config: result.config, name: this.name });
  }

  async confirmLeave() {
    if (!this.dirty) return true;
    return this.confirm({
      title: 'Discard unsaved changes?',
      body: html`<p>Your changes to <strong>${this._draft.name}</strong> have not been saved.
        Leaving this page discards them.</p>`,
      confirmLabel: 'Discard',
      negative: true,
    });
  }

  discard() {
    const { org, site } = this.site;
    if (this._draft.isNew) this.navigate({ org, site });
    else this._draft = createDraft({ config: this._config });
  }

  async save() {
    const { org, site, canWrite } = this.site;
    const draft = this._draft;
    if (!canWrite || !this.saveState.canSave) return;
    this._busy = true;
    // The schemas are reloaded with the save, so a failed save previews the current schemas.
    const [result, loaded] = await Promise.all([
      core.saveEndpoint({ org, site, config: draft }),
      core.loadSchemas({ org, site }),
    ]);
    this._busy = undefined;
    this._schemas = loaded.schemas ?? this._schemas;
    if (result.error) {
      showToast({ text: result.error, variant: VARIANT_ERROR });
      return;
    }
    const { config } = result;
    if (draft.isNew) {
      const endpoints = [...this.site.endpoints, config.name].sort();
      this.dispatchEvent(new CustomEvent('endpoints-change', { detail: { endpoints } }));
    }
    this._config = config;
    this._draft = createDraft({ config });
    showToast({ text: endpointSaved(config.name) });
    this.navigate({ org, site });
  }

  selectTab(id) {
    if (id === 'graphql') import('../sdl-panel/sdl-panel.js');
    this._tab = id;
  }

  renderTabs() {
    if (!this._draft) return nothing;
    return html`
      <nx-segmented-btn label="View" .items=${TABS} .value=${this._tab}
        @change=${({ detail }) => this.selectTab(detail.value)}></nx-segmented-btn>`;
  }

  // The search keeps its place, hidden, on the SDL tab so switching tabs doesn't move the bar.
  renderSearch() {
    if (!this._options.length) return nothing;
    const off = this._tab !== 'schemas';
    return html`
      <nx-search size="m" class=${off ? 'off' : nothing} ?inert=${off} placeholder="Search schemas"
        label="Search schemas" .value=${this._query}
        @input=${({ target }) => { this._query = target.value ?? ''; }}>
      </nx-search>`;
  }

  renderActions() {
    const draft = this._draft;
    if (!this.site.canWrite) return nothing;
    const busy = !!this._busy;
    const {
      canSave, pending, resave, hint,
    } = this.saveState;
    const unsaved = pending && !draft.isNew;
    let saveTitle = nothing;
    if (resave) saveTitle = RESAVE_TITLE;
    else if (!pending && !busy) saveTitle = HOLD_SHIFT_TITLE;
    return html`
      ${hint ? html`<span class="hint" title=${hint}>${hint}</span>` : nothing}
      ${unsaved ? renderStatusLight({ variant: 'notice', label: 'Unsaved changes' }) : nothing}
      <button type="button" class="nx-action-btn discard" ?disabled=${!pending || busy}
        @click=${this.discard}>${draft.isNew ? 'Cancel' : 'Discard'}</button>
      <button type="button" class="nx-btn-accent save" ?disabled=${!canSave}
        title=${saveTitle}
        @click=${this.save}>${busy ? 'Saving…' : 'Save'}</button>`;
  }

  renderBar() {
    const { org, site } = this.site;
    const loaded = !!this._draft;
    return renderHeader({
      org,
      site,
      endpoint: this.name,
      onChangeSite: () => this.dispatchEvent(new Event('change-site')),
      center: this.renderTabs(),
      end: loaded ? html`${this.renderSearch()}${this.renderActions()}` : undefined,
    });
  }

  renderNoSchemas() {
    if (!this.site.canWrite || this._draft.schemas.length || !this._options.length) return nothing;
    return renderInlineAlert({ variant: 'informative', heading: NO_SCHEMAS_MESSAGE });
  }

  renderPanel() {
    if (this._tab === 'graphql') {
      return html`
        <gql-sdl-panel .preview=${this._preview} ?hasSchemas=${this._draft.schemas.length > 0}
          @schemas-show=${() => this.selectTab('schemas')}></gql-sdl-panel>`;
    }
    const { canWrite } = this.site;
    return html`
      ${this.renderNoSchemas()}
      <gql-schemas-panel .options=${this._options} .query=${this._query}
        ?busy=${!!this._busy || !canWrite}
        schemaEditorHref=${getSchemaEditorHref({ ...this.site, origin: 'https://da.live' })}
        @schemas-select=${this.handleSelect}></gql-schemas-panel>`;
  }

  handleSelect({ detail }) {
    this._draft = selectSchemas({ draft: this._draft, ...detail });
  }

  renderContent() {
    if (!this._draft) return renderLoading('Loading endpoint…');
    const { label } = TABS.find(({ value }) => value === this._tab);
    return html`
      <section class="page ${this._tab}" aria-label=${label}>
        ${this.site.canWrite ? nothing : renderReadOnlyAlert()}
        ${this.renderPanel()}
      </section>`;
  }

  render() {
    return html`
      ${this.renderBar()}
      <div class="content">${this.renderContent()}</div>
      <gql-confirm></gql-confirm>`;
  }
}

customElements.define(EL_NAME, EndpointScreen);
