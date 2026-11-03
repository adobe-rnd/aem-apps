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

export function isPageEmpty(content) {
  if (!content || content.length === 0) return true;

  const normalized = content.replace(/\s+/g, '').toLowerCase();
  const emptyPatterns = [
    '<body><header></header><main><div></div></main><footer></footer></body>',
    '<body><header></header><main></main><footer></footer></body>',
    '<body><main><div></div></main></body>',
    '<body><main></main></body>',
    '<body></body>',
    '<html><body></body></html>',
  ];
  return emptyPatterns.includes(normalized);
}

export function getMatchContext(content, index, contextLength = 75) {
  const start = Math.max(0, index - contextLength);
  const end = Math.min(content.length, index + contextLength);
  return content.substring(start, end);
}

export function createSearchRegex(searchTerm, searchType, caseSensitive) {
  let pattern;
  const flags = caseSensitive ? 'g' : 'gi';
  switch (searchType) {
    case 'exact':
      pattern = `\\b${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
      break;
    case 'regex':
      pattern = searchTerm;
      break;
    case 'contains':
    default:
      pattern = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      break;
  }
  return new RegExp(pattern, flags);
}

// Preview and execution must use the same HTML pattern against unformatted DA source.
export function createHTMLSearchRegex(searchTerm, searchType, caseSensitive) {
  const cleanSearchTerm = searchTerm.trim();
  const flags = caseSensitive ? 'g' : 'gi';
  let pattern;
  if (searchType === 'regex') {
    pattern = cleanSearchTerm;
  } else {
    const escapedSearchTerm = cleanSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = escapedSearchTerm
      .replace(/<p>/g, '(<p>)?')
      .replace(/<\/p>/g, '(</p>)?')
      .replace(/>\s*</g, '>\\s*<')
      .replace(/>\s+/g, '>\\s*')
      .replace(/\s+</g, '\\s*<');
  }
  return new RegExp(pattern, flags);
}

// Match line/sequence identifiers depend on this legacy formatting; it is not an HTML serializer.
export function formatHTML(html) {
  let formatted = html;
  formatted = formatted.replace(/></g, '>\n<');
  formatted = formatted.replace(/<([^/][^>]*[^/])>/g, '<$1>\n');

  const lines = formatted.split('\n');
  let indentLevel = 0;
  const indentString = '  ';
  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('</')) {
      indentLevel = Math.max(0, indentLevel - 1);
    }
    const indentedLine = indentString.repeat(indentLevel) + trimmed;
    if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>')) {
      indentLevel += 1;
    }
    return indentedLine;
  });
  return formattedLines.join('\n');
}
