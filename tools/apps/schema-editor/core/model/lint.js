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
// Authoring linter: the authoring rules and keyword applicability that the SDK's
// `validateSchema` does not report.
// Issue: { code, severity, message, nodeId, schemaPath, defId?, field?, fix? }
// fix:   { label, run(model) → command result }, dispatched through the store (undoable).

import { ELEMENTS, PRIMITIVE_KINDS, elementOf } from './elements.js';
import {
  KEY_PATTERN, RESERVED_KEYS, DEF_NAME_PATTERN, deriveKey,
} from './keys.js';
import {
  walk, cyclicDefs, refUsages, siblingKeys,
} from './query.js';
import { updateNode, deleteDef } from './commands.js';

const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, info: 2 });

const SPEC_KEYWORDS = [
  'enum', 'format', 'x-semantic-type', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'minItems', 'maxItems', 'properties', 'required', 'items',
];
const HARMLESS_KEYWORDS = ['$comment', '$id', '$anchor', 'examples', 'deprecated', 'writeOnly'];
const STRING_EXCLUSIVE = ['enum', 'format', 'x-semantic-type'];
const MAX_DEPTH = 4;

const UNSUPPORTED_REASONS = {
  'R1-missing-type': ['error', 'Type is missing and cannot be inferred.'],
  'R2-unsupported-type': ['error', 'This type is not supported.'],
  'R3-type-array': ['error', 'Nullable / multiple types are not supported.'],
  'R6-tuple-items': ['error', 'Tuple lists are not supported.'],
  'R8-external-ref': ['error', 'Only references within this schema are supported.'],
  'R8-unresolved-ref': ['error', 'Component not found.'],
  'R8-non-defs-ref': ['warning', 'Reference doesn\'t point at a component.'],
  'R11-root-type': ['error', 'The schema must be a Group or a List.'],
  'unsupported-composition': ['error', 'Combining schemas (allOf, anyOf, oneOf, not, if) is not supported.'],
  'invalid-node': ['error', 'This entry is not a valid schema.'],
};

const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// No flags: the SDK compiles and tests patterns with a plain `new RegExp(pattern)`.
function compilePattern(pattern) {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Tries a sample against a pattern, for the live tester. */
export function testPattern(source, sample) {
  if (!source) return { state: 'empty', message: 'Any text is accepted.' };
  const re = compilePattern(source);
  if (!re) return { state: 'invalid', message: 'The pattern is not a valid regular expression.' };
  if (!sample) return { state: 'empty', message: 'Type a sample to try the pattern.' };
  return re.test(sample)
    ? { state: 'match', message: 'Matches.' }
    : { state: 'nomatch', message: 'Doesn\'t match.' };
}

function humanize(key) {
  const text = String(key ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_TIME = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:00(\.0+)?Z$/;

function isCalendarDay(match) {
  if (!match) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function checkFormat(variant, value) {
  if (variant === 'date' && !isCalendarDay(DATE.exec(value))) return 'Must be a date (YYYY-MM-DD).';
  if (variant === 'time' && !TIME.test(value)) return 'Must be a time (HH:MM or HH:MM:SS).';
  if (variant === 'date-time' && !isCalendarDay(DATE_TIME.exec(value))) {
    return 'Must be a UTC date and time (YYYY-MM-DDTHH:MM:00Z).';
  }
  return null;
}

/**
 * Checks a value against a primitive node's type and constraints, the way the SDK validates
 * form data (lengths count UTF-16 units); returns a message or null.
 */
export function checkValue(node, value) {
  if (node.kind === 'boolean') return typeof value === 'boolean' ? null : 'Must be on or off.';
  if (node.kind === 'number' || node.kind === 'integer') {
    if (!isNumber(value)) return 'Must be a number.';
    if (node.kind === 'integer' && !Number.isInteger(value)) return 'Must be a whole number.';
    if (isNumber(node.minimum) && value < node.minimum) return `Must be at least ${node.minimum}.`;
    if (isNumber(node.maximum) && value > node.maximum) return `Must be at most ${node.maximum}.`;
    return null;
  }
  if (node.kind !== 'string') return null;
  if (typeof value !== 'string') return 'Must be text.';
  if (node.variant === 'choice' && !(Array.isArray(node.enum) && node.enum.includes(value))) {
    return 'Must be one of the choices.';
  }
  const formatProblem = checkFormat(node.variant, value);
  if (formatProblem) return formatProblem;
  const { length } = value;
  if (isNonNegativeInt(node.minLength) && length < node.minLength) {
    return `Must be at least ${node.minLength} characters.`;
  }
  if (isNonNegativeInt(node.maxLength) && length > node.maxLength) {
    return `Must be at most ${node.maxLength} characters.`;
  }
  if (typeof node.pattern === 'string') {
    const re = compilePattern(node.pattern);
    if (re && !re.test(value)) return 'Must match the pattern.';
  }
  return null;
}

function removeExtraFix(node, keyword) {
  return {
    label: `Remove "${keyword}"`,
    run: (model) => {
      const rest = { ...node.extras };
      delete rest[keyword];
      return updateNode(model, {
        nodeId: node.id,
        patch: { extras: Object.keys(rest).length ? rest : undefined },
      });
    },
  };
}

const removeFieldFix = (node, field, label) => ({
  label,
  run: (model) => updateNode(model, { nodeId: node.id, patch: { [field]: undefined } }),
});

function lintExtras(node, report) {
  Object.keys(node.extras ?? {}).forEach((keyword) => {
    const fix = removeExtraFix(node, keyword);
    const at = { field: 'advanced', fix };
    if (node.kind === 'ref') {
      report('ref-sibling', 'warning', `"${keyword}" is ignored next to a component reference.`, at);
    } else if (node.kind === 'string' && STRING_EXCLUSIVE.includes(keyword)) {
      const value = node.extras[keyword];
      if (keyword === 'format' && node.variant === 'text') {
        report('unsupported-format', 'warning', `Format "${value}" is not supported and has no effect.`, at);
      } else if (keyword === 'x-semantic-type' && node.variant === 'text') {
        report('unsupported-semantic-type', 'warning', `"x-semantic-type: ${value}" is not supported.`, at);
      } else {
        const winner = ELEMENTS[elementOf(node)]?.label ?? node.variant;
        report('string-exclusive', 'warning', `"${keyword}" is ignored because the field is a ${winner}.`, at);
      }
    } else if (keyword === 'x-semantic-type') {
      report('unsupported-semantic-type', 'warning', '"x-semantic-type" only applies to text.', at);
    } else if (SPEC_KEYWORDS.includes(keyword)) {
      report('keyword-not-applicable', 'warning', `"${keyword}" does not apply to this element.`, at);
    } else if (HARMLESS_KEYWORDS.includes(keyword)) {
      report('ignored-keyword', 'info', `"${keyword}" is not used by the editor.`, at);
    } else {
      report('unsupported-keyword', 'warning', `"${keyword}" is not supported and has no effect.`, at);
    }
  });
}

function lintBounds(node, report) {
  ['minLength', 'maxLength', 'minItems', 'maxItems'].forEach((field) => {
    if (node[field] !== undefined && !isNonNegativeInt(node[field])) {
      report('negative-length', 'error', 'Must be a whole number of 0 or more.', { field });
    }
  });
  ['minimum', 'maximum'].forEach((field) => {
    if (node[field] !== undefined && !isNumber(node[field])) {
      report('invalid-number', 'error', 'Must be a number.', { field });
    } else if (node.kind === 'integer' && node[field] !== undefined && !Number.isInteger(node[field])) {
      report('integer-bounds', 'warning', 'Whole numbers should use whole-number limits.', { field });
    }
  });
  const pairs = [
    ['minLength', 'maxLength', 'range-length', 'Minimum length is greater than maximum length.'],
    ['minimum', 'maximum', 'range-number', 'Minimum is greater than maximum.'],
    ['minItems', 'maxItems', 'range-items', 'Minimum entries is greater than maximum entries.'],
  ];
  pairs.forEach(([min, max, code, message]) => {
    if (isNumber(node[min]) && isNumber(node[max]) && node[min] > node[max]) {
      report(code, 'error', message, { field: min });
    }
  });
}

function lintString(node, report) {
  if (node.pattern !== undefined) {
    if (typeof node.pattern !== 'string' || !compilePattern(node.pattern)) {
      report('invalid-pattern', 'error', 'The pattern is not a valid regular expression.', { field: 'pattern' });
    } else if (/^\^?\((?:[^()|]+\|)+[^()|]+\)\$?$/.test(node.pattern) && node.variant !== 'choice') {
      report('pattern-for-closed-set', 'info', 'This pattern lists fixed values — consider a Choice.', { field: 'pattern' });
    }
  }
  if (node.variant !== 'choice') return;
  ['minLength', 'maxLength', 'pattern'].forEach((field) => {
    if (node[field] !== undefined) {
      report('choice-constraint', 'info', `"${field}" also applies to a Choice but can't be edited here.`, { field: 'advanced', fix: removeFieldFix(node, field, `Remove "${field}"`) });
    }
  });
  if (!Array.isArray(node.enum) || !node.enum.length) {
    report('enum-empty', 'error', 'Add at least one choice.', { field: 'enum' });
    return;
  }
  if (node.enum.some((v) => typeof v !== 'string')) {
    report('enum-non-string', 'error', 'Choices must be text.', { field: 'enum' });
  }
  if (node.enum.some((v) => typeof v === 'string' && !v.trim())) {
    report('enum-blank', 'error', 'Choices cannot be empty.', { field: 'enum' });
  }
  if (new Set(node.enum).size !== node.enum.length) {
    report('enum-duplicate', 'error', 'Choices must be unique.', { field: 'enum' });
  }
  const blocked = node.enum.find((v) => typeof v === 'string' && v.trim() && checkValue(node, v));
  if (blocked !== undefined) {
    report('choice-unusable', 'warning', `Choice "${blocked}" can never be picked: ${checkValue(node, blocked)}`, { field: 'enum' });
  }
}

function lintNode(entry, report) {
  const { node, parent } = entry;

  if (node.kind === 'unsupported') {
    const [severity, message] = UNSUPPORTED_REASONS[node.reason] ?? ['error', 'Not supported.'];
    report(node.reason ?? 'unsupported', severity, `${message} It is kept as-is.`, { field: 'advanced' });
  }

  if (parent?.kind === 'object') {
    const others = siblingKeys(parent, node.id);
    const fix = {
      label: 'Derive key from label',
      run: (m) => updateNode(m, {
        nodeId: node.id,
        patch: { key: deriveKey(node.title || node.kind, others) },
      }),
    };
    if (RESERVED_KEYS.includes(node.key)) {
      report('R10-reserved-key', 'error', `"${node.key}" is reserved.`, { field: 'key', fix });
    } else if (!KEY_PATTERN.test(node.key ?? '')) {
      report('R9-invalid-key', 'error', 'Keys start with a letter and use letters, digits or "-".', { field: 'key', fix });
    } else if (others.includes(node.key)) {
      report('dup-key', 'error', `Duplicate key "${node.key}".`, { field: 'key', fix });
    }
  }

  if (node.kind === 'unsupported') return;
  lintExtras(node, report);
  if (node.kind === 'ref') return;

  if (!String(node.title ?? '').trim()) {
    const title = humanize(node.key) || ELEMENTS[elementOf(node)]?.label || 'Untitled';
    report('R4-missing-title', 'error', 'Label is required.', {
      field: 'title',
      fix: { label: `Use "${title}"`, run: (m) => updateNode(m, { nodeId: node.id, patch: { title } }) },
    });
  }
  if (node.missingType) {
    report('R1-missing-type', 'error', 'Type is missing.', { fix: { label: `Set type "${node.kind}"`, run: (m) => updateNode(m, { nodeId: node.id, patch: { missingType: undefined } }) } });
  }

  lintBounds(node, report);
  if (node.kind === 'string') lintString(node, report);

  if (node.default !== undefined && PRIMITIVE_KINDS.includes(node.kind)) {
    const problem = checkValue(node, node.default);
    if (problem) report('default-invalid', 'error', `Default: ${problem}`, { field: 'default' });
  }

  if (node.kind === 'object') {
    if (!node.children?.length) {
      const message = entry.path.length || entry.def
        ? 'Add at least one field to this Group.'
        : 'Add at least one field to the schema.';
      report('empty-group', 'error', message, {});
    }
    if (node.requiredUnknown?.length) {
      report('required-unknown', 'warning', `Required lists unknown fields: ${node.requiredUnknown.join(', ')}. They will be dropped on save.`, { fix: removeFieldFix(node, 'requiredUnknown', 'Drop unknown names') });
    }
  }
  if (node.kind === 'array' && !node.item) {
    report('R6-missing-items', 'error', 'Choose what each list entry is.', { field: 'item' });
  }

  if (node.required && node.readOnly && node.default === undefined) {
    report('readonly-required-nodefault', 'warning', 'Required and read-only without a default — authors can never fill it.', { field: 'default' });
  }
  if (node.required && node.default !== undefined) {
    report('required-with-default', 'info', 'A field with a default rarely needs to be required.', { field: 'required' });
  }
  if (entry.path.length === MAX_DEPTH + 1) {
    report('deep-nesting', 'info', 'Deeply nested — keep the schema flat where possible.', {});
  }
}

/** Lints the model; issues come errors first, then in document order. */
export function lint(model) {
  const issues = [];
  [...walk(model)].forEach((entry) => {
    const report = (code, severity, message, { field, fix } = {}) => {
      issues.push({
        code, severity, message, nodeId: entry.node.id, schemaPath: entry.pointer, field, fix,
      });
    };
    lintNode(entry, report);
  });

  model.defs.forEach((def) => {
    const pointer = `/$defs/${def.name}`;
    const report = (code, severity, message, fix) => issues.push({
      code, severity, message, nodeId: def.node.id, defId: def.id, schemaPath: pointer, field: 'name', fix,
    });
    if (!DEF_NAME_PATTERN.test(def.name)) {
      report('invalid-def-name', 'error', 'Component names start with a letter and use letters, digits, "-" or "_".');
    }
    if (!refUsages(model, def.id).length) {
      report('unused-component', 'info', `Component "${def.name}" is not used.`, { label: 'Delete component', run: (m) => deleteDef(m, { defId: def.id }) });
    }
  });
  cyclicDefs(model).forEach((def) => {
    issues.push({
      code: 'ref-cycle',
      severity: 'error',
      message: `Component "${def.name}" contains itself.`,
      nodeId: def.node.id,
      defId: def.id,
      schemaPath: `/$defs/${def.name}`,
    });
  });

  const rank = ({ issue }) => SEVERITY_ORDER[issue.severity];
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => rank(a) - rank(b) || a.i - b.i)
    .map(({ issue }) => issue);
}

export function worstSeverity(issues) {
  return (issues ?? []).reduce((worst, { severity }) => (
    worst && SEVERITY_ORDER[worst] <= SEVERITY_ORDER[severity] ? worst : severity
  ), null);
}

export function countIssues(issues) {
  return issues.reduce((acc, { severity }) => {
    acc[severity] += 1;
    return acc;
  }, { error: 0, warning: 0, info: 0 });
}

export function issuesByNode(issues) {
  const map = new Map();
  issues.forEach((issue) => {
    if (!map.has(issue.nodeId)) map.set(issue.nodeId, []);
    map.get(issue.nodeId).push(issue);
  });
  return map;
}
