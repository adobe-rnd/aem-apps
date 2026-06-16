function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createSearchRegex(searchTerm, searchType = 'contains', caseSensitive = false) {
  let pattern;
  const flags = caseSensitive ? 'g' : 'gi';

  switch (searchType) {
    case 'exact':
      pattern = `\\b${escapeRegExp(searchTerm)}\\b`;
      break;
    case 'regex':
      pattern = searchTerm;
      break;
    case 'contains':
    default:
      pattern = escapeRegExp(searchTerm);
      break;
  }

  return new RegExp(pattern, flags);
}

export function getMatchContext(content, index, contextLength = 75) {
  const start = Math.max(0, index - contextLength);
  const end = Math.min(content.length, index + contextLength);
  return content.substring(start, end);
}

export function formatHTML(html) {
  let formatted = html;
  formatted = formatted.replace(/></g, '>\n<');
  formatted = formatted.replace(/<([^/][^>]*[^/])>/g, '<$1>\n');

  const lines = formatted.split('\n').filter((line) => line.trim());
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

export function buildFlexibleHtmlSearchPattern(searchTerm, searchType = 'contains') {
  const cleanSearchTerm = searchTerm.trim();

  if (searchType === 'regex') {
    return cleanSearchTerm;
  }

  return escapeRegExp(cleanSearchTerm)
    .replace(/>\s*</g, '>\\s*<')
    .replace(/>\s+/g, '>\\s*')
    .replace(/\s+</g, '\\s*<')
    .replace(/<p>/g, '(<p>)?')
    .replace(/<\/p>/g, '(</p>)?');
}

export function findHtmlMatches(content, searchTerm, searchType = 'contains', caseSensitive = false) {
  if (!searchTerm) return [];

  const regex = new RegExp(
    buildFlexibleHtmlSearchPattern(searchTerm, searchType),
    caseSensitive ? 'g' : 'gi',
  );
  const matches = [];
  const lineMatchCounts = {};
  let match = regex.exec(content);

  while (match !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    lineMatchCounts[lineNum] = (lineMatchCounts[lineNum] || 0) + 1;

    matches.push({
      match: match[0],
      index: match.index,
      line: lineNum,
      context: getMatchContext(content, match.index, 150),
      sequenceOnLine: lineMatchCounts[lineNum],
    });

    match = regex.exec(content);
  }

  return matches;
}
