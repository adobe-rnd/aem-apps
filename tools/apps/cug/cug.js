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

/* global AggregateError */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  assertSiteExists, fetchCugState, generateCugHeaders, migrateCugSheet, saveCugRows, siteFromHash,
} from './data.js';

const siteInput = document.querySelector('#cug-site');
siteInput.value = siteFromHash(window.location.hash);

const getButton = document.querySelector('#cug-get');
const applyButton = document.querySelector('#cug-apply');
const status = document.querySelector('#cug-status');
const legacyNotice = document.querySelector('#cug-legacy-notice');
const migrateButton = document.querySelector('#cug-migrate');
const table = document.querySelector('.cug-rules');
const tbody = table.querySelector('tbody');
const rowTemplate = document.querySelector('#cug-row-template').content.querySelector('tr');
const groupTemplate = document.querySelector('#cug-group-template').content.querySelector('button');
const rowMenu = document.querySelector('#cug-row-menu');
const siteSections = [
  table.closest('.cug-table-scroll'),
  applyButton.closest('.cug-actions'),
];
let loadedSite = null;
let draggedRow = null;
let menuRow = null;
let savedRows = '[]';
let pendingHeadersSite = null;

function tableRows() {
  return [...tbody.rows].filter((row) => !row.hasAttribute('data-entry-row')).map((row) => ({
    path: row.querySelector('input').value,
    authentication: row.querySelector('.cug-auth-select').value,
    groups: [...row.querySelectorAll('.cug-group-chip span')].map((group) => group.textContent),
  }));
}

function updateActionButtons() {
  const unavailable = table.getAttribute('aria-busy') === 'true'
    || loadedSite === null || siteInput.value.trim() !== loadedSite;
  applyButton.disabled = unavailable
    || (JSON.stringify(tableRows()) === savedRows && pendingHeadersSite !== loadedSite);
}

function updateRowLabels() {
  [...tbody.rows].forEach((row, index) => {
    const rule = index + 1;
    row.querySelector('input').setAttribute('aria-label', `Path for rule ${rule}`);
    const drag = row.querySelector('.cug-drag');
    const entry = row.hasAttribute('data-entry-row');
    drag.draggable = !entry;
    drag.disabled = entry;
    drag.setAttribute('aria-label', `Move rule ${rule}`);
    drag.setAttribute('aria-expanded', String(menuRow === row));
    const remove = row.querySelector('.cug-delete');
    remove.setAttribute('aria-label', `Delete rule ${rule}`);
    remove.disabled = entry;
    row.querySelector('.cug-auth-select').setAttribute('aria-label', `Authentication for rule ${rule}`);
    row.querySelector('.cug-groups').setAttribute('aria-label', `Groups for rule ${rule}`);
    row.querySelector('.cug-group-add').setAttribute('aria-label', `Add group to rule ${rule}`);
    row.querySelectorAll('.cug-group-chip').forEach((chip) => {
      chip.setAttribute('aria-label', `Remove ${chip.querySelector('span').textContent} group from rule ${rule}`);
    });
    row.querySelector('.cug-group-input')?.setAttribute('aria-label', `Add group to rule ${rule}`);
  });
  updateActionButtons();
}

function announceChange(message) {
  status.hidden = false;
  status.removeAttribute('data-error');
  status.textContent = `${message} Click Apply to save.`;
}

function closeRowMenu() {
  menuRow?.querySelector('.cug-drag').setAttribute('aria-expanded', 'false');
  menuRow = null;
  rowMenu.hidden = true;
}

function endDrag() {
  draggedRow = null;
  tbody.querySelectorAll('.cug-dragging, .cug-drop-before, .cug-drop-after').forEach((row) => {
    row.classList.remove('cug-dragging', 'cug-drop-before', 'cug-drop-after');
  });
}

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('.cug-delete');
  if (!button || table.getAttribute('aria-busy') === 'true') return;
  const row = button.closest('tr');
  if (row.hasAttribute('data-entry-row')) return;
  const next = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  updateRowLabels();
  (next?.querySelector('input') || getButton).focus();
  announceChange('Rule deleted.');
});

tbody.addEventListener('keydown', (event) => {
  const handle = event.target.closest('.cug-drag');
  if (!handle || handle.disabled || table.getAttribute('aria-busy') === 'true'
    || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const row = handle.closest('tr');
  const up = event.key === 'ArrowUp';
  const target = up ? row.previousElementSibling : row.nextElementSibling;
  if (!target || target.hasAttribute('data-entry-row')) return;
  tbody.insertBefore(row, up ? target : target.nextElementSibling);
  updateRowLabels();
  handle.focus();
  announceChange(`Rule moved to position ${[...tbody.rows].indexOf(row) + 1}.`);
});

tbody.addEventListener('dragstart', (event) => {
  closeRowMenu();
  const handle = event.target.closest('.cug-drag');
  if (!handle || handle.disabled || table.getAttribute('aria-busy') === 'true') {
    event.preventDefault();
    return;
  }
  draggedRow = handle.closest('tr');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedRow.querySelector('input').value);
  draggedRow.classList.add('cug-dragging');
});

tbody.addEventListener('dragover', (event) => {
  const target = event.target.closest('tr');
  if (!draggedRow || !target || table.getAttribute('aria-busy') === 'true') return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  tbody.querySelectorAll('.cug-drop-before, .cug-drop-after').forEach((row) => {
    row.classList.remove('cug-drop-before', 'cug-drop-after');
  });
  if (target === draggedRow) return;
  const bounds = target.getBoundingClientRect();
  target.classList.add(target.hasAttribute('data-entry-row') || event.clientY < bounds.top + bounds.height / 2
    ? 'cug-drop-before' : 'cug-drop-after');
});

tbody.addEventListener('drop', (event) => {
  const target = event.target.closest('tr');
  if (!draggedRow || !target || table.getAttribute('aria-busy') === 'true') return;
  event.preventDefault();
  if (target !== draggedRow) {
    const bounds = target.getBoundingClientRect();
    tbody.insertBefore(draggedRow, target.hasAttribute('data-entry-row') || event.clientY < bounds.top + bounds.height / 2
      ? target : target.nextElementSibling);
    updateRowLabels();
    draggedRow.querySelector('.cug-drag').focus();
    announceChange(`Rule moved to position ${[...tbody.rows].indexOf(draggedRow) + 1}.`);
  }
  endDrag();
});

tbody.addEventListener('dragend', endDrag);

async function daFetch(url, options) {
  const { actions } = await DA_SDK;
  return actions.daFetch(url, options);
}

function setBusy(busy) {
  if (busy) {
    endDrag();
    closeRowMenu();
  }
  getButton.disabled = busy;
  migrateButton.disabled = busy;
  siteInput.readOnly = busy;
  tbody.inert = busy;
  table.setAttribute('aria-busy', String(busy));
  updateActionButtons();
}

siteInput.addEventListener('input', () => {
  legacyNotice.hidden = true;
  updateActionButtons();
});

function createGroupChip(group) {
  const chip = groupTemplate.cloneNode(true);
  chip.querySelector('span').textContent = group;
  return chip;
}

function createRow({ path, authentication, groups }) {
  const row = rowTemplate.cloneNode(true);
  row.querySelector('input').value = path;
  row.querySelector('.cug-auth-select').value = authentication;
  const groupList = row.querySelector('.cug-groups');
  const addButton = groupList.querySelector('.cug-group-add');
  groups.forEach((group) => {
    addButton.before(createGroupChip(group));
  });
  return row;
}

function ensureEntryRow() {
  const entry = tbody.querySelector('[data-entry-row]');
  if (entry && (entry.querySelector('input').value !== ''
    || entry.querySelector('.cug-auth-select').value !== ''
    || entry.querySelector('.cug-group-chip'))) {
    entry.removeAttribute('data-entry-row');
  }
  if (!tbody.querySelector('[data-entry-row]')) {
    const row = createRow({ path: '', authentication: '', groups: [] });
    row.dataset.entryRow = 'true';
    tbody.append(row);
  }
  updateRowLabels();
}

tbody.addEventListener('click', (event) => {
  const handle = event.target.closest('.cug-drag');
  if (!handle || handle.disabled || table.getAttribute('aria-busy') === 'true') return;
  const row = handle.closest('tr');
  const wasOpen = menuRow === row;
  closeRowMenu();
  if (wasOpen) return;
  menuRow = row;
  handle.setAttribute('aria-expanded', 'true');
  rowMenu.hidden = false;
  const bounds = handle.getBoundingClientRect();
  rowMenu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - rowMenu.offsetWidth - 8))}px`;
  rowMenu.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - rowMenu.offsetHeight - 8))}px`;
  rowMenu.querySelector('button').focus();
});

rowMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-position]');
  if (!button || !menuRow?.isConnected || table.getAttribute('aria-busy') === 'true') return;
  const row = createRow({ path: '', authentication: '', groups: [] });
  tbody.insertBefore(row, button.dataset.position === 'above' ? menuRow : menuRow.nextElementSibling);
  closeRowMenu();
  ensureEntryRow();
  row.querySelector('input').focus();
  announceChange('Row inserted.');
});

rowMenu.addEventListener('keydown', (event) => {
  const buttons = [...rowMenu.querySelectorAll('button')];
  if (event.key === 'Escape') {
    event.preventDefault();
    const handle = menuRow?.querySelector('.cug-drag');
    closeRowMenu();
    handle?.focus();
  } else if (event.key === 'Tab') {
    closeRowMenu();
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    let index = buttons.indexOf(document.activeElement);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].focus();
  }
});

document.addEventListener('click', (event) => {
  if (!rowMenu.contains(event.target) && !event.target.closest('.cug-drag')) closeRowMenu();
});
window.addEventListener('scroll', closeRowMenu, true);
window.addEventListener('resize', closeRowMenu);

tbody.addEventListener('change', (event) => {
  if (!event.target.matches('.cug-auth-select') || table.getAttribute('aria-busy') === 'true') return;
  ensureEntryRow();
});

function commitGroup(input) {
  const group = input.value.trim();
  if (group.includes(',')) {
    input.setCustomValidity('Enter one group at a time, without commas.');
    input.reportValidity();
    return false;
  }
  input.onblur = null;
  if (group) {
    input.before(createGroupChip(group));
  }
  input.remove();
  ensureEntryRow();
  return true;
}

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('.cug-group-add, .cug-group-chip');
  if (!button || table.getAttribute('aria-busy') === 'true') return;
  const list = button.closest('.cug-groups');
  if (button.classList.contains('cug-group-chip')) {
    button.remove();
    updateActionButtons();
    list.querySelector('.cug-group-add').focus();
    return;
  }
  const existing = list.querySelector('.cug-group-input');
  if (existing) {
    existing.focus();
    return;
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cug-group-input';
  input.placeholder = 'Enter group';
  input.setAttribute('aria-label', button.getAttribute('aria-label'));
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key === 'Enter') {
      keyEvent.preventDefault();
      if (commitGroup(input)) button.focus();
    } else if (keyEvent.key === 'Escape') {
      keyEvent.preventDefault();
      input.onblur = null;
      input.remove();
      button.focus();
    }
  });
  input.onblur = () => {
    if (input.isConnected) commitGroup(input);
  };
  button.before(input);
  input.focus();
});

tbody.addEventListener('input', (event) => {
  if (event.target === event.target.closest('tr')?.cells[1].querySelector('input')) {
    ensureEntryRow();
  }
});

function renderRows(rows) {
  tbody.replaceChildren(...rows.map(createRow));
  ensureEntryRow();
}

async function loadRules(migrate = false) {
  if (getButton.disabled || (migrate && legacyNotice.hidden)) return;
  legacyNotice.hidden = true;
  loadedSite = null;
  setBusy(true);
  siteSections.forEach((section) => { section.hidden = true; });
  status.hidden = false;
  status.textContent = migrate ? 'Copying spreadsheet...' : 'Loading rules...';
  status.removeAttribute('data-error');
  let sheetCopied = false;
  try {
    await assertSiteExists(siteInput.value, daFetch);
    if (migrate) {
      await migrateCugSheet(siteInput.value, daFetch);
      sheetCopied = true;
      pendingHeadersSite = siteInput.value.trim();
      status.textContent = 'Spreadsheet copied. Loading rules...';
    }
    const { rows, hasLegacySheet } = await fetchCugState(siteInput.value, daFetch);
    legacyNotice.hidden = !hasLegacySheet;
    if (hasLegacySheet) {
      status.hidden = true;
      return;
    }
    renderRows(rows);
    savedRows = JSON.stringify(tableRows());
    loadedSite = siteInput.value.trim();
    siteSections.forEach((section) => { section.hidden = false; });
    status.textContent = rows.length
      ? `Loaded ${rows.length} rule${rows.length === 1 ? '' : 's'}.`
      : 'No rules found. Add a rule in the empty row below.';
  } catch (error) {
    tbody.replaceChildren();
    status.dataset.error = 'true';
    status.textContent = sheetCopied
      ? `Spreadsheet copied, but rules could not be loaded: ${error.message} Click Load to retry.`
      : `Could not ${migrate ? 'migrate' : 'load'} rules: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

document.querySelector('#cug-site-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadRules();
});

migrateButton.addEventListener('click', async () => {
  await loadRules(true);
});

applyButton.addEventListener('click', async () => {
  setBusy(true);
  status.hidden = false;
  status.textContent = 'Saving rules...';
  status.removeAttribute('data-error');
  let sheetSaved = false;
  try {
    if (loadedSite === null || loadedSite !== siteInput.value.trim()) {
      throw new Error('Load rules for this org/site before saving.');
    }
    const pendingGroups = [...tbody.querySelectorAll('.cug-group-input')];
    if (!pendingGroups.every((input) => commitGroup(input))) {
      throw new Error('Enter one group at a time, without commas.');
    }
    const rows = tableRows();
    const sheet = await saveCugRows(loadedSite, rows, daFetch);
    sheetSaved = true;
    legacyNotice.hidden = true;
    savedRows = JSON.stringify(rows);
    pendingHeadersSite = loadedSite;
    status.textContent = 'Rules saved. Applying headers...';
    const result = await generateCugHeaders(loadedSite, sheet, daFetch);
    pendingHeadersSite = null;
    status.textContent = `Saved ${rows.length} rule${rows.length === 1 ? '' : 's'} and applied headers to ${result.cugPaths} path${result.cugPaths === 1 ? '' : 's'}.`;
  } catch (error) {
    status.dataset.error = 'true';
    const list = document.createElement('ul');
    const errors = error instanceof AggregateError ? error.errors : [error];
    errors.forEach((detail) => {
      const item = document.createElement('li');
      item.textContent = detail.message;
      list.append(item);
    });
    status.replaceChildren(sheetSaved
      ? 'Rules were saved, but applying headers failed:'
      : 'Could not save rules:', list);
    if (sheetSaved) status.append('Click Apply to retry.');
  } finally {
    setBusy(false);
  }
});
