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
import { LitElement, html, nothing } from 'da-lit';
import 'https://da.live/nx2/blocks/shared/dialog/dialog.js';
import 'https://da.live/nx2/blocks/shared/picker/picker.js';
import { loadHrefSvg } from 'https://da.live/nx2/utils/svg.js';
import getStyle from 'https://da.live/nx/public/utils/styles.js';
import {
  loadPageSnapshots, normalizeContext, sanitizeName, scheduledPublish, snapshotAppHref,
  snapshotStatus,
} from './utils.js';

const NX2 = 'https://da.live/nx2';

let sheets = [];
try {
  sheets = await Promise.all([
    getStyle(`${NX2}/styles/buttons.css`),
    getStyle(`${NX2}/styles/form.css`),
    getStyle(new URL('./snapshots.css', import.meta.url).href),
  ]);
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('Failed to load snapshot panel styles:', e);
}

const COPY_MODE_ACTIONS = [
  { label: 'Cancel', value: 'cancel', variant: 'secondary' },
  { label: 'Merge', value: 'merge' },
  { label: 'Overwrite', value: 'overwrite' },
];

function renderStatus(manifest) {
  const { label, tone } = snapshotStatus(manifest);
  return html`<span class="status ${tone}">${label}</span>`;
}

function renderSchedule(manifest) {
  const date = scheduledPublish(manifest);
  if (!date) return nothing;
  const short = date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return html`<span class="status scheduled" title="Scheduled to publish ${date.toLocaleString()}">Scheduled · ${short}</span>`;
}

const s2Icon = (name) => `${NX2}/public/icons/S2_Icon_${name}_20_N.svg`;
const [arrowDownSvg, arrowUpSvg] = await Promise.all([
  loadHrefSvg(s2Icon('ArrowDown')),
  loadHrefSvg(s2Icon('ArrowUp')),
]);

// Clone per use: one SVG node can only sit in one place in the DOM
const inlineIcon = (svg) => {
  if (!svg) return nothing;
  const el = svg.cloneNode(true);
  el.setAttribute('aria-hidden', 'true');
  return el;
};

const NEW_SNAPSHOT_MANIFEST = { title: '', description: '', metadata: { reviewPassword: '' } };

class SnapshotsPanel extends LitElement {
  static properties = {
    context: { attribute: false },
    api: { attribute: false },
    _state: { state: true },
    _error: { state: true },
    _containing: { state: true },
    _others: { state: true },
    _failed: { state: true },
    _permissions: { state: true },
    _busy: { state: true },
    _notice: { state: true },
    _dialog: { state: true },
    _target: { state: true },
    _newName: { state: true },
  };

  _epoch = 0;

  _return = () => {
    if (document.visibilityState === 'visible' && !this._busy && !this._dialog) this.refresh();
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = sheets;
    document.addEventListener('visibilitychange', this._return);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this._return);
  }

  updated(changed) {
    if (changed.has('context') || changed.has('api')) this.refresh({ permissions: true });
  }

  get page() { return normalizeContext(this.context); }

  async refresh({ permissions = false } = {}) {
    const { page, api } = this;
    if (!page || !api) {
      this._state = 'error';
      this._error = 'Open a page to manage its snapshots.';
      return;
    }
    this._epoch += 1;
    const epoch = this._epoch;
    if (!this._containing) this._state = 'loading';
    const [result, perms] = await Promise.all([
      loadPageSnapshots({ api, path: page.path }),
      permissions || !this._permissions ? this.loadPermissions() : this._permissions,
    ]).catch((e) => [{ error: e.message || 'Could not load snapshots.' }, this._permissions]);
    if (epoch !== this._epoch) return;
    this._permissions = perms;
    if (result.error) {
      this._state = 'error';
      this._error = result.error;
      return;
    }
    this._containing = result.containing;
    this._others = result.others;
    this._failed = result.failed;
    this._state = 'ready';
  }

  async loadPermissions() {
    const { api, page } = this;
    const [launch, registered, publish] = await Promise.all([
      api.getLaunchPermission(),
      api.isRegistered(),
      api.getPublishPermission({ path: page.path }),
    ]);
    return { launch, registered, publish };
  }

  async run(label, task) {
    if (this._busy) return;
    this._busy = label;
    this._notice = undefined;
    try {
      const result = await task();
      if (result?.error) this._notice = { tone: 'negative', text: result.error };
      else if (result?.text) this._notice = { tone: 'positive', text: result.text };
    } catch (e) {
      this._notice = { tone: 'negative', text: e.message || 'Something went wrong.' };
    } finally {
      await this.refresh();
      this._busy = undefined;
    }
  }

  confirm(details) {
    return new Promise((resolve) => {
      this._dialog = { ...details, resolve };
    });
  }

  handleDialogAction(value) {
    const dialog = this._dialog;
    if (!dialog) return;
    this._dialog = undefined;
    dialog.resolve(value);
  }

  async handleCopy(snap, direction) {
    const { api } = this;
    const { name, resource, hasSource } = snap;
    // Merge falls back to a plain copy when the snapshot page is missing.
    const mode = direction === 'fork' && !hasSource ? 'merge' : await this.confirm({
      heading: `${direction === 'fork' ? 'Sync Down' : 'Promote Up'}: Merge or Overwrite?`,
      message: html`<b>Merge</b> will merge the files and show a diff.<br/><b>Overwrite</b> will replace the destination content entirely.`,
      actions: COPY_MODE_ACTIONS,
    });
    if (mode !== 'merge' && mode !== 'overwrite') return;
    const label = direction === 'fork' ? 'Syncing content into snapshot' : 'Promoting content from snapshot';
    this.run(label, async () => {
      const { status } = await api.copyPage({
        name, path: resource.path, direction, mode,
      });
      if (status !== 'success') return { error: `Could not ${direction === 'fork' ? 'sync' : 'promote'} this page.` };
      return { text: direction === 'fork' ? 'Synced from main content.' : 'Promoted to main content.' };
    });
  }

  handleRemove({ name, resource }) {
    this.run('Removing page', () => this.api.removePaths({ name, paths: [resource.path] }));
  }

  handleReview({ name }, state) {
    this.run('Saving', () => this.api.review({ name, state }));
  }

  async handleApprove({ name, manifest }) {
    const { api } = this;
    const count = manifest.resources?.length || 0;
    const schedule = this._permissions?.registered && this._permissions?.publish
      ? scheduledPublish(manifest)
      : undefined;
    const choice = await this.confirm({
      heading: 'Approve & Publish Snapshot',
      message: schedule
        ? html`<b>${name}</b> (${count} page${count === 1 ? '' : 's'}) is scheduled to publish on ${schedule.toLocaleString()}.<br/><br/>Approve the scheduled publish?`
        : html`This will directly publish all ${count} page${count === 1 ? '' : 's'} in <b>${name}</b> to production.<br/>Existing prod content will be overwritten.<br/><br/>Are you sure?`,
      actions: [
        { label: 'Cancel', value: 'cancel', variant: 'secondary' },
        { label: schedule ? 'Approve' : 'Publish', value: 'publish' },
      ],
    });
    if (choice !== 'publish') return;
    if (schedule) {
      this.run('Scheduling', async () => {
        const { status, text } = await api.updateSchedule({ name, approved: true });
        if (status !== 200) return { error: text || 'Failed to schedule publish' };
        return { text: 'Snapshot publish has been scheduled successfully.' };
      });
      return;
    }
    this.run('Publishing', () => api.review({ name, state: 'approve' }));
  }

  handleAddExisting(e) {
    e.preventDefault();
    const name = this._target;
    if (!name || this.isLocked(name)) return;
    this.run('Adding page', async () => {
      const result = await this.api.addPaths({ name, paths: [this.page.path] });
      if (!result.error) this._target = undefined;
      return result;
    });
  }

  handleCreate(e) {
    e.preventDefault();
    const name = sanitizeName(this._newName || '').replace(/^-+|-+$/g, '');
    if (!name) return;
    if ([...this._containing, ...this._others].some((snap) => snap.name === name)) {
      this._notice = { tone: 'negative', text: `A snapshot named ${name} already exists.` };
      return;
    }
    this.run('Creating snapshot', async () => {
      const created = await this.api.saveManifest({ name, manifest: NEW_SNAPSHOT_MANIFEST });
      if (created.error) return created;
      const result = await this.api.addPaths({ name, paths: [this.page.path] });
      if (!result.error) this._newName = '';
      return result;
    });
  }

  renderSnapshot(snap) {
    const {
      name, manifest, resource, hasSource,
    } = snap;
    const { locked } = manifest;
    const busy = !!this._busy;
    const launch = this._permissions?.launch && manifest.metadata?.launchEnabled === true;
    return html`
      <li class="snapshot">
        <div class="snapshot-heading">
          <div class="snapshot-name">
            <h3>${name}</h3>
            ${manifest.title ? html`<p>${manifest.title}</p>` : nothing}
          </div>
          <div class="snapshot-badges">
            ${renderStatus(manifest)}
            ${renderSchedule(manifest)}
          </div>
        </div>
        <div class="snapshot-links">
          <a class="nx-action-btn nx-btn-sm" href=${resource.url} target="_blank" rel="noopener">Open on aem.reviews</a>
          ${hasSource ? html`<a class="nx-action-btn nx-btn-sm" href=${resource.daSnapshotEdit} target="_blank" rel="noopener">Edit snapshot content</a>` : nothing}
        </div>
        ${launch ? html`
          <p class="group-label">Content</p>
          <div class="snapshot-content">
            <button type="button" class="nx-action-btn nx-btn-sm" title="Sync from main content" ?disabled=${busy} @click=${() => this.handleCopy(snap, 'fork')}>${inlineIcon(arrowDownSvg)} Sync</button>
            ${hasSource ? html`<button type="button" class="nx-action-btn nx-btn-sm" title="Promote to main content" ?disabled=${busy} @click=${() => this.handleCopy(snap, 'promote')}>${inlineIcon(arrowUpSvg)} Promote</button>` : nothing}
          </div>
        ` : nothing}
        <p class="group-label">Review</p>
        <div class="snapshot-review">
          <button type="button" class="nx-action-btn nx-btn-sm" ?disabled=${busy || locked} @click=${() => this.handleReview(snap, 'request')}>Request review</button>
          <button type="button" class="nx-action-btn nx-btn-sm" ?disabled=${busy || !locked} @click=${() => this.handleReview(snap, 'reject')}>Reject & unlock</button>
          <button type="button" class="nx-action-btn nx-btn-sm" ?disabled=${busy || !locked} @click=${() => this.handleApprove(snap)}>Approve & publish</button>
        </div>
        <div class="snapshot-footer">
          <button type="button" class="nx-action-btn-quiet nx-btn-sm" ?disabled=${busy || locked}
            title=${locked ? 'Unlock snapshot to edit URLs.' : nothing}
            @click=${() => this.handleRemove(snap)}>Remove page</button>
          <a class="nx-action-btn-quiet nx-btn-sm" href=${snapshotAppHref({ ...this.page, name })} target="_blank" rel="noopener">Manage snapshot</a>
        </div>
      </li>
    `;
  }

  isLocked(name) {
    return !!this._others?.find((snap) => snap.name === name)?.manifest?.locked;
  }

  renderAdd() {
    const available = this._others.filter((snap) => snap.manifest);
    const busy = !!this._busy;
    const items = available.map(({ name, manifest }) => ({
      value: name,
      label: name,
      description: manifest.locked ? 'Locked' : undefined,
    }));
    const lockedTarget = this.isLocked(this._target);
    return html`
      <section class="add">
        <h2>Add this page</h2>
        ${available.length ? html`
          <form class="add-row" @submit=${this.handleAddExisting}>
            <div class="nx-form-field">
              <label id="snapshot-target-label">Existing snapshot</label>
              <nx-picker variant="field" size="m" placeholder="Choose a snapshot"
                aria-labelledby="snapshot-target-label"
                .items=${items} .value=${this._target}
                @change=${(e) => { this._target = e.detail.value; }}></nx-picker>
            </div>
            <button type="submit" class="nx-form-btn-primary" ?disabled=${busy || !this._target || lockedTarget}>Add</button>
          </form>
          ${lockedTarget ? html`<p class="field-hint">Unlock this snapshot to add pages.</p>` : nothing}
        ` : nothing}
        <form class="add-row" @submit=${this.handleCreate}>
          <div class="nx-form-field">
            <label for="snapshot-new">New snapshot</label>
            <input id="snapshot-new" class="nx-input" placeholder="snapshot-name" .value=${this._newName || ''}
              @input=${(e) => { e.target.value = sanitizeName(e.target.value); this._newName = e.target.value; }}>
          </div>
          <button type="submit" class="nx-form-btn-primary" ?disabled=${busy || !this._newName}>Create</button>
        </form>
      </section>
    `;
  }

  renderDialog() {
    const { heading, message, actions } = this._dialog;
    return html`
      <nx-dialog title=${heading} @close=${() => this.handleDialogAction('cancel')}>
        <div class="dialog-message">${message}</div>
        ${actions.map(({ label, value, variant }) => html`
          <button type="button" slot="actions"
            class=${variant === 'secondary' ? 'nx-form-btn-secondary' : 'nx-form-btn-primary'}
            @click=${() => this.handleDialogAction(value)}>${label}</button>
        `)}
      </nx-dialog>
    `;
  }

  renderReady() {
    const count = this._containing.length;
    const failed = this._failed?.length || 0;
    return html`
      ${failed ? html`
        <div class="notice warning" role="alert">
          <span>Couldn't load ${failed} snapshot${failed === 1 ? '' : 's'}, so this list may be incomplete.</span>
          <button type="button" class="nx-action-btn-quiet nx-btn-sm" ?disabled=${!!this._busy} @click=${() => this.refresh()}>Retry</button>
        </div>
      ` : nothing}
      <section class="current">
        <h2>${count ? `In ${count} snapshot${count === 1 ? '' : 's'}` : 'Not in a snapshot'}</h2>
        ${count ? html`<ul class="snapshots">${this._containing.map((snap) => this.renderSnapshot(snap))}</ul>` : nothing}
      </section>
      ${this.renderAdd()}
    `;
  }

  render() {
    const { page } = this;
    return html`
      <header class="panel-header">
        <p class="page-path" title=${page?.path || nothing}>${page?.path || ''}</p>
        ${page ? html`<a class="nx-action-btn nx-btn-sm" href=${snapshotAppHref(page)} target="_blank" rel="noopener">All snapshots</a>` : nothing}
      </header>
      ${this._busy ? html`<p class="notice busy" role="status">${this._busy}…</p>` : nothing}
      ${this._notice ? html`<p class="notice ${this._notice.tone}" role="status">${this._notice.text}</p>` : nothing}
      ${this._state === 'loading' ? html`<p class="notice" role="status">Loading snapshots…</p>` : nothing}
      ${this._state === 'error' ? html`<p class="notice negative" role="alert">${this._error}</p>` : nothing}
      ${this._state === 'ready' ? this.renderReady() : nothing}
      ${this._dialog ? this.renderDialog() : nothing}
    `;
  }
}

if (!customElements.get('snapshots-panel')) customElements.define('snapshots-panel', SnapshotsPanel);
