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
/* eslint-disable import/no-unresolved */
import { html, nothing } from 'da-lit';
import { ACTIONS, MISSING_PAGES, ON_COMPLETE } from '../../../localization/core/domain/config.js';
import {
  ACTION_HELP, MISSING_PAGES_HELP, ON_COMPLETE_LABELS, CONFLICT_LABELS, TRANSLATION_PROVIDERS,
  DEFAULT_PROVIDER, isRoot, actionsOf, conflictOf, sourceOptions, describeRow, providerLabel,
  idOf,
} from '../data/config-draft.js';
import { ACTION_LABELS } from '../data/display.js';
import { badge } from './common.js';

const COMMON_LANGUAGES = ['en', 'en-US', 'en-GB', 'en-CA', 'fr', 'fr-FR', 'fr-CA', 'de', 'de-DE', 'es', 'es-ES', 'es-MX', 'es-419', 'it', 'pt-BR', 'ja', 'ko', 'zh-Hans', 'nl'];

const levelOf = (value) => value.trim();

function depthMap(site, draft, locations) {
  const depth = (id, seen = new Set()) => {
    const source = locations.get(id)?.source;
    if (!source || seen.has(id) || !locations.has(source)) return 0;
    seen.add(id);
    return 1 + depth(source, seen);
  };
  return new Map(draft.map((row) => [row.uid, depth(idOf(site, row))]));
}

function summary(row) {
  if (isRoot(row)) return 'Root';
  const actions = actionsOf(row).map((action) => ACTION_LABELS[action] ?? action);
  return `${row.values.source} · ${actions.join(', ') || 'no actions'}`;
}

function renderList(ctx) {
  const depths = depthMap(ctx.site, ctx.draft, ctx.validation.locations);
  return html`
    <section class="config-list" aria-label="Locations">
      <div class="config-list-head">
        <h2>Locations <span class="muted">${ctx.draft.length}</span></h2>
        <button type="button" class="btn small" @click=${() => ctx.onAdd(null)}>Add root</button>
      </div>
      ${ctx.draft.length ? html`
        <ul class="config-rows">
          ${ctx.draft.map((row) => {
    const info = describeRow(ctx.site, row);
    const issues = ctx.validation.byUid.get(row.uid) ?? [];
    const errors = issues.filter((issue) => issue.level === 'error').length;
    const active = row.uid === ctx.selectedUid;
    return html`
              <li>
                <button type="button" class="config-row ${active ? 'active' : ''}"
                  style="padding-inline-start: ${10 + depths.get(row.uid) * 18}px"
                  aria-current=${active ? 'true' : 'false'}
                  @click=${() => ctx.onSelect(row.uid)}>
                  <span class="config-row-head">
                    <strong>${info.title}</strong>
                    ${row.values.language ? html`<span class="lang">${row.values.language}</span>` : nothing}
                    ${errors ? badge(`${errors} ${errors === 1 ? 'error' : 'errors'}`, 'negative') : nothing}
                    ${!errors && issues.length ? badge('Warning', 'notice') : nothing}
                  </span>
                  <span class="config-row-path">${info.path}</span>
                  <span class="muted small-text">${summary(row)}</span>
                </button>
              </li>`;
  })}
        </ul>` : html`<p class="muted">No locations yet. Add a root location to start.</p>`}
    </section>`;
}

function field(label, control, help) {
  return html`
    <label class="config-field">
      <span class="config-label">${label}</span>
      ${control}
      ${help ? html`<span class="option-help">${help}</span>` : nothing}
    </label>`;
}

function renderIssues(issues) {
  if (!issues.length) return nothing;
  return html`
    <ul class="config-issues" role="alert">
      ${issues.map((issue) => html`
        <li class=${issue.level}>${badge(issue.level === 'error' ? 'Error' : 'Warning', issue.level === 'error' ? 'negative' : 'notice')}
          <span>${issue.message}</span></li>`)}
    </ul>`;
}

function renderRelationship(row, ctx) {
  const set = (name, value) => ctx.onChange(ctx.setValue(row, name, value));
  const actions = actionsOf(row);
  const conflict = conflictOf(row);
  const provider = row.values.translationProvider || DEFAULT_PROVIDER;
  const chosen = TRANSLATION_PROVIDERS.find((entry) => entry.id === provider);
  return html`
    <fieldset class="config-group">
      <legend>Actions</legend>
      ${ACTIONS.map((action) => html`
        <label class="config-check">
          <input type="checkbox" .checked=${actions.includes(action)}
            @change=${(event) => ctx.onChange(ctx.toggleAction(row, action, event.target.checked))}>
          <span><strong>${ACTION_LABELS[action] ?? action}</strong>
            <span class="option-help">${ACTION_HELP[action]}</span></span>
        </label>`)}
    </fieldset>
    ${actions.includes('translate') ? html`
      <div class="config-block">
        ${field('Translation provider', html`
          <select .value=${provider} @change=${(event) => set('translationProvider', event.target.value)}>
            ${TRANSLATION_PROVIDERS.map((entry) => html`
              <option value=${entry.id} ?selected=${entry.id === provider}>${entry.label}${entry.connected ? '' : ' (not connected)'}</option>`)}
          </select>`, chosen?.connected
    ? 'Used when translating into this location.'
    : `${providerLabel(provider)} is not connected yet. Translations still run through Google Translate.`)}
      </div>` : nothing}
    <div class="config-grid">
      ${field('Missing pages', html`
        <select .value=${row.values.missingPages || 'none'}
          @change=${(event) => set('missingPages', event.target.value)}>
          ${MISSING_PAGES.map((value) => html`<option value=${value} ?selected=${(row.values.missingPages || 'none') === value}>${value === 'linked' ? 'Serve from source' : 'Leave missing'}</option>`)}
        </select>`, MISSING_PAGES_HELP[row.values.missingPages || 'none'])}
      ${field('After rollout or translation', html`
        <select .value=${row.values.onComplete || 'none'}
          @change=${(event) => set('onComplete', event.target.value)}>
          ${ON_COMPLETE.map((value) => html`<option value=${value} ?selected=${(row.values.onComplete || 'none') === value}>${ON_COMPLETE_LABELS[value]}</option>`)}
        </select>`)}
      ${field('When local edits conflict', html`
        <select .value=${conflict.first}
          @change=${(event) => ctx.onChange(ctx.setConflict(row, { ...conflict, first: event.target.value }))}>
          ${Object.entries(CONFLICT_LABELS).map(([value, label]) => html`<option value=${value} ?selected=${conflict.first === value}>${label}</option>`)}
        </select>`, 'Default choice in the rollout drawer.')}
      <label class="config-check config-check-inline">
        <input type="checkbox" .checked=${conflict.both}
          @change=${(event) => ctx.onChange(ctx.setConflict(row, { ...conflict, both: event.target.checked }))}>
        <span>Let people pick the other conflict option</span>
      </label>
    </div>`;
}

function renderEditor(row, ctx) {
  if (!row) {
    return html`<aside class="detail config-editor"><p class="detail-empty">Select a location to edit it, or add a new one.</p></aside>`;
  }
  const issues = ctx.validation.byUid.get(row.uid) ?? [];
  const set = (name, value) => ctx.onChange(ctx.setValue(row, name, value));
  const options = sourceOptions({
    site: ctx.site, draft: ctx.draft, sites: ctx.sites, row,
  });
  const known = options.some((option) => option.value === row.values.source);
  const levels = [...new Set(ctx.draft.map((each) => levelOf(each.values.level)).filter(Boolean))];
  const info = describeRow(ctx.site, row);
  return html`
    <aside class="detail config-editor" aria-label="Edit location">
      <header class="detail-header">
        <h2>${info.title}</h2>
        <p class="detail-title-sub">${info.id}</p>
      </header>
      ${renderIssues(issues)}
      <div class="config-grid">
        ${field('Path', html`<input type="text" .value=${row.values.path} spellcheck="false"
          @input=${(event) => set('path', event.target.value)}>`, 'Folder this location owns, e.g. /fr-ca. Use / for the whole site.')}
        ${field('Language', html`<input type="text" list="config-languages" .value=${row.values.language} spellcheck="false"
          @input=${(event) => set('language', event.target.value)}>
          <datalist id="config-languages">${COMMON_LANGUAGES.map((code) => html`<option value=${code}></option>`)}</datalist>`, 'BCP 47 code, e.g. en-US')}
        ${field('Label', html`<input type="text" .value=${row.values.label}
          placeholder="Generated from the language"
          @input=${(event) => set('label', event.target.value)}>`)}
        ${field('Level', html`<input type="text" list="config-levels" .value=${row.values.level}
          @input=${(event) => set('level', event.target.value)}>
          <datalist id="config-levels">${levels.map((level) => html`<option value=${level}></option>`)}</datalist>`, 'Free text, e.g. Region, Locale')}
      </div>
      ${field('Source', html`
        <select .value=${row.values.source} @change=${(event) => set('source', event.target.value)}>
          <option value="" ?selected=${!row.values.source}>None (root location)</option>
          ${known || !row.values.source ? nothing : html`<option value=${row.values.source} selected>${row.values.source} (unknown)</option>`}
          ${options.map((option) => html`<option value=${option.value} ?selected=${option.value === row.values.source}>${option.label}${option.label === option.value ? '' : ` (${option.value})`}</option>`)}
        </select>`, 'The location this one gets its content from. Same site: /path. Other site: site:/path.')}
      ${isRoot(row) ? html`<p class="muted">Root locations have no relationship settings.</p>` : renderRelationship(row, ctx)}
      <div class="config-editor-actions">
        <button type="button" class="btn small" @click=${() => ctx.onAdd(row)}>Add child</button>
        <button type="button" class="btn small" @click=${() => ctx.onDuplicate(row)}>Duplicate</button>
        <span class="spacer"></span>
        <button type="button" class="btn small destructive" @click=${() => ctx.onDelete(row)}>Remove</button>
      </div>
    </aside>`;
}

function renderSummary(ctx) {
  const { errors, warnings, unplaced } = ctx.validation;
  const general = unplaced;
  return html`
    <div class="config-status">
      ${ctx.dirty ? badge('Unsaved changes', 'notice') : badge('Saved', 'positive')}
      ${errors.length ? badge(`${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`, 'negative') : nothing}
      ${warnings.length ? badge(`${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`, 'notice') : nothing}
      <span class="spacer"></span>
      <button type="button" class="btn" ?disabled=${!ctx.dirty || ctx.saving} @click=${() => ctx.onDiscard()}>Discard changes</button>
      <button type="button" class="btn accent" ?disabled=${!ctx.canSave}
        @click=${() => ctx.onSave()}>${ctx.saving ? 'Saving…' : 'Save configuration'}</button>
    </div>
    ${ctx.writable ? nothing : html`<p class="app-notice">Saving is not available in this environment.</p>`}
    ${ctx.saveError ? html`<p class="error-text" role="alert">${ctx.saveError}</p>` : nothing}
    ${general.length ? renderIssues(general) : nothing}`;
}

export default function renderConfigView(ctx) {
  const selected = ctx.draft.find((row) => row.uid === ctx.selectedUid);
  return html`
    <section class="config-view" aria-label="Configuration">
      <p class="muted config-intro">
        Locations for <strong>${ctx.site}</strong>, stored in the <code>locations</code> sheet of the site config.
        Saving rewrites that sheet; other config sheets are kept.
      </p>
      ${renderSummary(ctx)}
      <div class="workspace">
        ${renderList(ctx)}
        ${renderEditor(selected, ctx)}
      </div>
    </section>`;
}
