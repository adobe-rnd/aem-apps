/**
 * Resolve the main data array from a sheet/multi-sheet JSON using :names.
 * Works regardless of the sheet name (data, blocks, bla, etc.).
 * @param {object} json - Parsed sheet or multi-sheet JSON
 * @param {string[]} [excludeNames=['options']] - Sheet names to skip (e.g. options)
 * @returns {unknown[]} The data array, or [] if none found
 */
function getSheetDataArray(json, excludeNames = ['options']) {
  const names = json?.[':names'];
  if (Array.isArray(names)) {
    const firstValid = names.find((name) => {
      if (excludeNames.includes(name)) return false;
      const sheet = json[name];
      if (sheet == null) return false;
      const arr = sheet?.data ?? (Array.isArray(sheet) ? sheet : null);
      return Array.isArray(arr);
    });
    if (firstValid != null) {
      const sheet = json[firstValid];
      const arr = sheet?.data ?? (Array.isArray(sheet) ? sheet : null);
      return arr;
    }
    return [];
  }
  const fallback = json?.data?.data || json?.data || [];
  return Array.isArray(fallback) ? fallback : [];
}

export default getSheetDataArray;
