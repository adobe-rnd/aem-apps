/**
 * Escapes a string for safe interpolation into HTML.
 * Prevents XSS by converting the five dangerous HTML characters to entities.
 * @param {string} str - Value to escape
 * @returns {string} HTML-safe string
 */
export default function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
