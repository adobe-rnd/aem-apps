import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setSheet } from '../../../../../../tools/apps/config-console/shared/utils/sheet-json.js';

describe('setSheet', () => {
  it('registers a new sheet in :names', () => {
    const config = { ':type': 'multi-sheet', ':names': ['data'], data: { data: [] } };
    const rows = [{ title: 'Request Publish' }];
    setSheet(config, 'prepare', rows);
    assert.deepEqual(config[':names'], ['data', 'prepare']);
    assert.deepEqual(config.prepare, { data: rows, total: 1, limit: 1 });
  });

  it('does not duplicate an existing name and keeps extra sheet props', () => {
    const config = { ':names': ['library'], library: { data: [], ':colWidths': [100] } };
    setSheet(config, 'library', [{ title: 'a' }, { title: 'b' }]);
    assert.deepEqual(config[':names'], ['library']);
    assert.equal(config.library.total, 2);
    assert.deepEqual(config.library[':colWidths'], [100]);
  });
});
