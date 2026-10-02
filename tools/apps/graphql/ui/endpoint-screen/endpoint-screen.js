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
import { getSchemaEditorHref } from '../utils/route.js';
import {
  createDraft, getSaveBlocker, getSaveState, isDirty, selectSchemas,
} from './helpers/draft.js';
import { endpointSaved } from '../utils/messages.js';
import { inlineAlertStyle, renderReadOnlyAlert } from '../shared/inline-alert/inline-alert.js';
import { messageStyle, renderLoading } from '../shared/message/message.js';
import { renderStatusLight, statusLightStyle } from '../shared/status-light/status-light.js';
import '../header/header.js';
import '../endpoint-editor/endpoint-editor.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-endpoint-screen';

// One endpoint's screen; `isNew` starts an unsaved endpoint called `name`.
class EndpointScreen extends LitElement {
  static properties = {
    site: { attribute: false },
    name: { type: String },
    isNew: { type: Boolean },
    _config: { state: true },
    _draft: { state: true },
    _schemas: { state: true },
    _busy: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [
      buttonStyle, inlineAlertStyle, messageStyle, statusLightStyle, style,
    ];
  }

  get dirty() {
    return isDirty({ draft: this._draft, config: this._config });
  }

  willUpdate(props) {
    if (props.has('site') || props.has('name')) this.load();
    if (props.has('_draft') || props.has('_schemas')) {
      this._preview = this._draft
        ? this._sdlModule.buildSdl({ schemaIds: this._draft.schemas, schemas: this._schemas })
        : undefined;
    }
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

  get blocker() {
    return getSaveBlocker({
      draft: this._draft, preview: this._preview, existing: this.site.endpoints,
    });
  }

  async save() {
    const { org, site, canWrite } = this.site;
    const draft = this._draft;
    if (this._busy || !canWrite || this.blocker) return;
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

  renderActions() {
    const draft = this._draft;
    if (!draft || !this.site.canWrite) return nothing;
    const { dirty } = this;
    const busy = !!this._busy;
    const { canSave, hint } = getSaveState({
      draft, blocker: this.blocker, dirty, busy,
    });
    return html`
      <div class="save-actions">
        ${hint ? html`<p class="hint">${hint}</p>` : nothing}
        ${dirty && !draft.isNew
    ? renderStatusLight({ variant: 'notice', label: 'Unsaved changes' })
    : nothing}
        <sl-button class="primary outline" ?disabled=${(!dirty && !draft.isNew) || busy}
          @click=${() => this.discard()}>${draft.isNew ? 'Cancel' : 'Discard'}</sl-button>
        <sl-button class="primary" ?disabled=${!canSave}
          @click=${() => this.save()}>${busy ? 'Saving…' : 'Save'}</sl-button>
      </div>`;
  }

  renderEditor() {
    const draft = this._draft;
    if (!draft) return renderLoading('Loading endpoint…');
    return html`
      <gql-endpoint-editor
        .draft=${draft}
        .schemas=${this._schemas}
        .savedSchemas=${this._config?.schemas}
        .preview=${this._preview}
        schemaEditorHref=${getSchemaEditorHref({ ...this.site, origin: 'https://da.live' })}
        ?busy=${!!this._busy}
        ?readOnly=${!this.site.canWrite}
        @schemas-select=${({ detail }) => { this._draft = selectSchemas({ draft, ...detail }); }}>
      </gql-endpoint-editor>`;
  }

  render() {
    const { org, site } = this.site;
    return html`
      <gql-header org=${org} site=${site} endpoint=${this.name}>
        ${this.renderActions()}
      </gql-header>
      ${this.site.canWrite ? nothing : renderReadOnlyAlert()}
      ${this.renderEditor()}
      <gql-confirm></gql-confirm>`;
  }
}

customElements.define(EL_NAME, EndpointScreen);
