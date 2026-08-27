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
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

const sdk = DA_SDK;

/**
 * Matches Franklin's toClassName — produces the same heading IDs the rendered page will have.
 * @param {string} name
 */
function toClassName(name) {
  return name.toLowerCase().replace(/[^0-9a-z]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function getPageUrl() {
  const { context } = await sdk;
  const path = context.path.replace(/\/index$/, '') || '/';
  return `https://main--${context.repo}--${context.org}.aem.page${path}`;
}

function getSelectedLinks() {
  const links = [];
  document.querySelectorAll('input[name="selected-headings"]:checked').forEach((checkbox) => {
    const index = checkbox.id.split('-')[1];
    const titleInput = document.getElementById(`title-${index}`);
    const title = titleInput ? titleInput.value.trim() : checkbox.dataset.headingText;
    if (title) links.push({ id: checkbox.value, title });
  });
  return links;
}

function updateCreateButton() {
  document.getElementById('create-links').disabled = getSelectedLinks().length === 0;
}

async function scanPageHeadings() {
  const statusEl = document.getElementById('status-message');
  const mainContent = document.getElementById('main-content');
  const headingsList = document.getElementById('headings-list');

  statusEl.textContent = 'Scanning page for headings…';
  statusEl.className = 'status-message loading';

  try {
    const { context, actions } = await sdk;
    const sourceUrl = `${DA_ORIGIN}/source/${context.org}/${context.repo}${context.path}.html`;
    const response = await actions.daFetch(sourceUrl);
    if (!response.ok) throw new Error(`DA source fetch failed: ${response.status}`);

    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .map((h) => ({ el: h, text: h.textContent.trim(), id: toClassName(h.textContent.trim()) }))
      .filter(({ text, id }) => text && id);

    if (headings.length === 0) {
      statusEl.textContent = 'No headings found in this document.';
      statusEl.className = 'status-message error';
      return;
    }

    headingsList.innerHTML = '';

    headings.forEach(({ el, text, id }, index) => {
      const optionContainer = document.createElement('div');
      optionContainer.className = 'heading-option';

      const checkboxRow = document.createElement('div');
      checkboxRow.className = 'heading-checkbox-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'selected-headings';
      checkbox.value = id;
      checkbox.id = `heading-${index}`;
      checkbox.dataset.headingText = text;

      const label = document.createElement('label');
      label.htmlFor = `heading-${index}`;
      label.textContent = `${el.tagName}: ${text}`;

      checkboxRow.appendChild(checkbox);
      checkboxRow.appendChild(label);

      const titleField = document.createElement('div');
      titleField.className = 'title-field';
      titleField.innerHTML = `
        <label for="title-${index}">Link title</label>
        <input type="text" id="title-${index}" value="${text}" placeholder="Enter link title">
      `;

      checkbox.addEventListener('change', () => {
        titleField.classList.toggle('visible', checkbox.checked);
        updateCreateButton();
      });

      titleField.querySelector('input').addEventListener('input', updateCreateButton);

      optionContainer.appendChild(checkboxRow);
      optionContainer.appendChild(titleField);
      headingsList.appendChild(optionContainer);
    });

    mainContent.hidden = false;
    statusEl.textContent = '';
    statusEl.className = 'status-message';
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Jump links scan failed:', error);
    statusEl.textContent = 'Could not load page content. Check your connection and try again.';
    statusEl.className = 'status-message error';
  }
}

async function createJumpLinks() {
  const selected = getSelectedLinks();
  if (selected.length === 0) return;

  const baseUrl = await getPageUrl();
  const linksHtml = selected
    .map(({ id, title }) => `<p><a href="${baseUrl}#${id}" title="${title}">${title}</a></p>`)
    .join('');

  const { actions } = await sdk;
  actions.sendHTML(linksHtml);
  actions.closeLibrary();
}

document.getElementById('create-links').addEventListener('click', createJumpLinks);
scanPageHeadings();
