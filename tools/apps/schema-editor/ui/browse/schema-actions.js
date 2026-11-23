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

// Schema intents on the browse screen: a catalog call plus its follow-up UX (dialog,
// confirmation, toast), and the menus that offer them. Keeps <se-browse> to listing.

import { deriveSchemaName } from '../../core/model/keys.js';
import { confirmDialog } from '../shared/confirm.js';
import { iconFile } from '../shared/icons.js';
import { toast } from '../shared/toast.js';
import { schemaDialog } from './schema-dialog.js';

const OLD_EDITOR = 'https://da.live/apps/schema';

const NEW_ITEMS = [
  {
    id: 'blank', label: 'Blank', icon: iconFile('add'), description: 'Start from an empty schema.',
  },
  {
    id: 'json',
    label: 'From JSON Schema…',
    icon: iconFile('code'),
    description: 'Paste an existing schema definition.',
  },
];

const AI_ITEM = {
  id: 'ai', label: 'With AI…', icon: iconFile('ai'), description: 'Describe it to the assistant.',
};

/** The New menu; "With AI…" only when the assistant is available. */
export const newSchemaItems = (withAi) => (withAi ? [...NEW_ITEMS, AI_ITEM] : NEW_ITEMS);

/** Each row's menu; ids name the row actions `<se-browse>` runs. */
export const ROW_ITEMS = [
  { id: 'open', label: 'Open', icon: iconFile('edit') },
  { id: 'duplicate', label: 'Duplicate…', icon: iconFile('duplicate') },
  { id: 'copy', label: 'Copy JSON', icon: iconFile('code') },
  { id: 'old', label: 'Open in old editor', icon: iconFile('schema') },
  { divider: true },
  { id: 'delete', label: 'Delete…', icon: iconFile('delete') },
];

export function openInOldEditor({ org, site }) {
  window.open(`${OLD_EDITOR}#/${org}/${site}`, '_blank', 'noopener');
}

/** Asks for a title and name (and, `fromJson`, the schema to import), then creates it. */
export function createSchema(catalog, { names, fromJson, onCreated }) {
  schemaDialog({
    title: fromJson ? 'New schema from JSON Schema' : 'New schema',
    confirmLabel: 'Create',
    existingNames: names,
    withJson: fromJson,
    onSubmit: async ({ title, name, json }) => {
      const result = await catalog.create({ name, title, json });
      if (result.ok) onCreated(name);
      return result;
    },
  });
}

export function duplicateSchema(catalog, item, { title, names, onCreated }) {
  schemaDialog({
    title: `Duplicate "${title}"`,
    confirmLabel: 'Duplicate',
    existingNames: names,
    withTitle: false,
    initialName: deriveSchemaName(`${item.name} copy`, names),
    onSubmit: async ({ name }) => {
      const result = await catalog.duplicate({ from: item.name, name });
      if (result.ok) onCreated(name);
      return result;
    },
  });
}

export async function copySchemaJson(catalog, item) {
  const { raw, error } = await catalog.rawJson(item);
  if (error) {
    toast({ message: `Couldn't read "${item.name}": ${error}`, variant: 'negative' });
    return;
  }
  try {
    await navigator.clipboard.writeText(raw);
    toast({ message: 'Schema JSON copied.', variant: 'positive' });
  } catch {
    toast({ message: 'Couldn\'t access the clipboard.', variant: 'negative' });
  }
}

/**
 * Confirms (typing the name, unless the schema is known to have no fields), then deletes.
 * @returns {Promise<boolean>} whether the schema was deleted
 */
export async function deleteSchema(catalog, item, { title, fields }) {
  const confirmed = await confirmDialog({
    title: `Delete "${title}"?`,
    message: `Documents that use "${item.name}" will no longer open in the form editor.`,
    confirmLabel: 'Delete',
    destructive: true,
    requireText: fields > 0 ? item.name : undefined,
  });
  if (!confirmed) return false;
  const { ok, error } = await catalog.remove(item);
  if (!ok) {
    toast({ message: `Couldn't delete "${item.name}": ${error}`, variant: 'negative' });
    return false;
  }
  toast({ message: `Deleted "${item.name}".`, variant: 'positive' });
  return true;
}
