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
import { targetTree, pagePathFrom } from '../msm-next/model.js';

const DEFAULT_REASON = 'The page has no target locations in the site configuration.';

export function targetRows(model, site, path) {
  const rows = [];
  const walk = (nodes, depth, parentId) => nodes.forEach((node) => {
    const { location } = node;
    rows.push({
      id: location.id,
      parentId,
      depth,
      label: location.label,
      language: location.language,
      site: node.site,
      path: node.path,
    });
    walk(node.children ?? [], depth + 1, location.id);
  });
  walk(targetTree(model, { site, path: pagePathFrom(path) }), 0, null);
  return rows;
}

export async function loadTargets({
  org, site, path, daFetch,
}) {
  const [{ createLocalization }, { default: guardFetch }] = await Promise.all([
    import('../../localization/core/index.js'),
    import('../../localization/core/api/guard-fetch.js'),
  ]);
  const localization = createLocalization({ org, actions: { daFetch: guardFetch(daFetch) } });
  const model = await localization.orgModel();
  return targetRows(model, site, path);
}

export function buildPrompt({ source, targets }) {
  const lines = targets.map((target) => `- ${target.label} (${target.language}): ${target.path}`);
  return [
    `Create a content proposal for the latest changes on ${pagePathFrom(source)}.`,
    'Compare the page with its previous saved version to find the changes.',
    'Targets:',
    ...lines,
    'Do not write to the target pages.',
  ].join('\n');
}

export const emptyReason = () => DEFAULT_REASON;

export async function sendToChat(actions, text, { autoSend = true, clipboard } = {}) {
  if (typeof actions?.setPrompt === 'function') {
    actions.setPrompt(text, { autoSend });
    return autoSend ? 'sent' : 'filled';
  }
  const board = clipboard ?? (typeof navigator === 'undefined' ? undefined : navigator.clipboard);
  if (board?.writeText) {
    await board.writeText(text);
    return 'copied';
  }
  return 'unsupported';
}
