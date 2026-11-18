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
import { html } from 'da-lit';
import { folderState, hasSeveralSites } from '../data/folders.js';

function renderFolder(folder, ctx) {
  const state = folderState(folder, ctx.picked);
  const count = folder.keys.size;
  return html`
    <li role="none" style="--indent: ${folder.depth}">
      <label class="folder-row" role="menuitemcheckbox" aria-checked=${state === 'some' ? 'mixed' : String(state === 'all')}>
        <input type="checkbox" .checked=${state === 'all'} .indeterminate=${state === 'some'}
          @change=${(event) => ctx.onToggle(folder, event.target.checked)}>
        <span class="folder-name">${folder.name}</span>
        <span class="folder-count">${count} ${count === 1 ? 'page' : 'pages'}</span>
      </label>
    </li>`;
}

export default function renderFolderMenu(folders, ctx) {
  const withSite = hasSeveralSites(folders);
  return html`
    <div class="folder-menu-wrap">
      <button type="button" class="btn small" aria-haspopup="true" aria-expanded=${String(ctx.open)}
        ?disabled=${!folders.length}
        title=${folders.length ? 'Select all pages in a folder' : 'There are no folders to select'}
        @click=${ctx.onOpen}>Select folder…</button>
      ${ctx.open ? html`
        <div class="folder-backdrop" @click=${ctx.onClose}></div>
        <div class="folder-menu" role="dialog" aria-label="Select pages by folder"
          @keydown=${(event) => { if (event.key === 'Escape') ctx.onClose(); }}>
          <p class="folder-hint">Selects every source page in the folder and its sub-folders.${ctx.filtering ? ' Pages hidden by the current filters are not included.' : ''}</p>
          <ul class="folder-list" role="menu">
            ${folders.map((folder, index) => html`
              ${withSite && folder.site !== folders[index - 1]?.site
    ? html`<li role="presentation" class="folder-site">${folder.site}</li>` : ''}
              ${renderFolder(folder, ctx)}`)}
          </ul>
          <div class="folder-footer">
            <button type="button" class="btn quiet small" @click=${ctx.onClose}>Done</button>
          </div>
        </div>` : ''}
    </div>`;
}
