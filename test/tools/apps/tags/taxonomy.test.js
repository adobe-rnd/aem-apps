import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaxonomyTree,
  serializeTaxonomyTree,
  flattenTaxonomyTags,
  buildTaxonomySheet,
} from '../../../../tools/apps/tags/taxonomy.js';

// Sparse rows (only the keys relevant to that row) — parsing must tolerate
// this legacy/hand-authored shape even though serialize always emits fully
// keyed rows now. A namespace with a direct tag, a namespace mixing a
// direct tag with a categorized one (in either order), and a nested
// category — each Tag row carries its own Category, so order doesn't matter.
const rows = [
  { Namespace: 'Article Types' },
  { Tag: 'Race Recap', Description: 'A recap of a race' },
  { Namespace: 'Tag Driven' },
  { Tag: 'Race Recap' },
  { Category: 'catlev1', Tag: 'Alpha' },
  { Category: 'catlev1/catlev2', Tag: 'Beta', Description: 'Beta desc' },
];

describe('parseTaxonomyTree', () => {
  it('builds a namespace/category/tag tree from flat rows', () => {
    const tree = parseTaxonomyTree(rows);

    assert.equal(tree.namespaces.length, 2);
    const [articleTypes, tagDriven] = tree.namespaces;

    assert.equal(articleTypes.name, 'Article Types');
    assert.equal(articleTypes.children.length, 1);
    assert.equal(articleTypes.children[0].name, 'Race Recap');
    assert.equal(articleTypes.children[0].description, 'A recap of a race');
    assert.equal(articleTypes.children[0].children.length, 0);

    assert.equal(tagDriven.name, 'Tag Driven');
    assert.equal(tagDriven.children.length, 2);
    const [directTag, catlev1] = tagDriven.children;
    assert.equal(directTag.name, 'Race Recap');
    assert.equal(catlev1.name, 'catlev1');
    assert.equal(catlev1.children.length, 2);
    const [alpha, catlev2] = catlev1.children;
    assert.equal(alpha.name, 'Alpha');
    assert.equal(catlev2.name, 'catlev2');
    assert.equal(catlev2.children[0].name, 'Beta');
    assert.equal(catlev2.children[0].description, 'Beta desc');
  });

  it('does not let a Category row bleed into unrelated Tag rows that follow it', () => {
    // Regression: Category used to be inherited statefully, so a direct tag
    // placed after a categorized one would incorrectly attach to that
    // category. Category is now read directly off each Tag row instead.
    const mixedRows = [
      { Namespace: 'NS' },
      { Tag: 'DirectA' },
      { Category: 'Reviews', Tag: 'InReviews' },
      { Tag: 'DirectB' },
    ];
    const tree = parseTaxonomyTree(mixedRows);
    const ns = tree.namespaces[0];
    const [directA, reviews, directB] = ns.children;
    assert.equal(directA.name, 'DirectA');
    assert.equal(directB.name, 'DirectB');
    assert.equal(reviews.name, 'Reviews');
    assert.equal(reviews.children[0].name, 'InReviews');
  });

  it('reads Description on Namespace/Category rows too, not just Tag', () => {
    const describedRows = [
      { Namespace: 'NS', Description: 'ns desc' },
      { Category: 'Cat', Tag: 'Leaf', Description: 'leaf desc' },
    ];
    const tree = parseTaxonomyTree(describedRows);
    assert.equal(tree.namespaces[0].description, 'ns desc');
    assert.equal(tree.namespaces[0].children[0].name, 'Cat');
    assert.equal(tree.namespaces[0].children[0].children[0].description, 'leaf desc');
  });

  it('treats an empty string the same as a missing key', () => {
    // serializeTaxonomyTree emits every column on every row (empty string
    // where it doesn't apply) — parsing must not treat that empty string as
    // a real value.
    const fullyKeyedRows = [
      {
        Namespace: 'NS', Category: '', Tag: '', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'DirectTag', Description: '',
      },
    ];
    const tree = parseTaxonomyTree(fullyKeyedRows);
    assert.equal(tree.namespaces[0].children[0].name, 'DirectTag');
    assert.equal(tree.namespaces[0].children[0].children.length, 0);
  });
});

describe('flattenTaxonomyTags', () => {
  it('produces the tags plugin\'s exact path convention for every leaf', () => {
    const tree = parseTaxonomyTree(rows);
    const paths = flattenTaxonomyTags(tree).map((t) => t.path);
    assert.deepEqual(paths, [
      'Article Types:Race Recap',
      'Tag Driven:Race Recap',
      'Tag Driven:catlev1',
      'Tag Driven:catlev1/Alpha',
      'Tag Driven:catlev1/catlev2',
      'Tag Driven:catlev1/catlev2/Beta',
    ]);
  });

  it('also flattens categories themselves as selectable tags, not just their leaves', () => {
    // A category (a node with children) can be applied as a tag in its own
    // right, alongside anything nested under it.
    const tree = parseTaxonomyTree(rows);
    const tagDriven = flattenTaxonomyTags(tree).filter((t) => t.namespace === 'Tag Driven');
    const catlev1 = tagDriven.find((t) => t.tag === 'catlev1');
    assert.equal(catlev1.category, '');
    assert.equal(catlev1.path, 'Tag Driven:catlev1');

    const catlev2 = tagDriven.find((t) => t.tag === 'catlev2');
    assert.equal(catlev2.category, 'catlev1');
    assert.equal(catlev2.path, 'Tag Driven:catlev1/catlev2');
  });
});

describe('serializeTaxonomyTree', () => {
  const ALL_COLUMNS = ['Namespace', 'Category', 'Tag', 'Description'];

  it('emits all four columns on every row, matching a real spreadsheet\'s rectangular shape', () => {
    // Regression: rows used to only carry the keys relevant to that row
    // (e.g. a Tag row had no Namespace/Category key at all). AEM/DA's
    // column detection didn't reliably pick up a column that was simply
    // absent from a row's keys, so publishing silently dropped Category
    // and Tag as columns even though `columns` declared them.
    const tree = parseTaxonomyTree(rows);
    serializeTaxonomyTree(tree).forEach((row) => {
      assert.deepEqual(Object.keys(row), ALL_COLUMNS);
    });
  });

  it('round-trips a tree, reconstructing an equivalent structure', () => {
    const tree = parseTaxonomyTree(rows);
    const reparsed = parseTaxonomyTree(serializeTaxonomyTree(tree));
    assert.deepEqual(reparsed, tree);
  });

  it('round-trips a tree to the exact expected fully-keyed rows', () => {
    const tree = parseTaxonomyTree(rows);
    assert.deepEqual(serializeTaxonomyTree(tree), [
      {
        Namespace: 'Article Types', Category: '', Tag: '', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'Race Recap', Description: 'A recap of a race',
      },
      {
        Namespace: 'Tag Driven', Category: '', Tag: '', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'Race Recap', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'catlev1', Description: '',
      },
      {
        Namespace: '', Category: 'catlev1', Tag: 'Alpha', Description: '',
      },
      {
        Namespace: '', Category: 'catlev1', Tag: 'catlev2', Description: '',
      },
      {
        Namespace: '', Category: 'catlev1/catlev2', Tag: 'Beta', Description: 'Beta desc',
      },
    ]);
  });

  it('represents a category node as an ordinary Tag row, not a distinct shape', () => {
    // A category is just a tag that has children — its own row (Tag: its
    // name, Category: its ancestors' path) looks exactly like a leaf tag's.
    const tree = parseTaxonomyTree(rows);
    const tagDriven = tree.namespaces.find((n) => n.name === 'Tag Driven');
    const catlev1 = tagDriven.children.find((n) => n.name === 'catlev1');
    assert.ok(catlev1.children.length > 0);

    const catlev1Row = serializeTaxonomyTree(tree).find((row) => row.Tag === 'catlev1');
    assert.deepEqual(catlev1Row, {
      Namespace: '', Category: '', Tag: 'catlev1', Description: '',
    });
  });

  it('round-trips a category description alongside its tags', () => {
    // The input still uses the old Category-only row shape (no Tag) —
    // parseTaxonomyTree keeps accepting that (Postel's law), even though
    // serializeTaxonomyTree no longer produces it.
    const describedRows = [
      { Namespace: 'NS' },
      { Category: 'Cat', Description: 'cat desc' },
      { Category: 'Cat', Tag: 'Leaf' },
    ];
    const tree = parseTaxonomyTree(describedRows);
    assert.equal(tree.namespaces[0].children[0].description, 'cat desc');
    assert.deepEqual(serializeTaxonomyTree(tree), [
      {
        Namespace: 'NS', Category: '', Tag: '', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'Cat', Description: 'cat desc',
      },
      {
        Namespace: '', Category: 'Cat', Tag: 'Leaf', Description: '',
      },
    ]);
  });

  it('preserves order when a direct tag is interleaved between categorized tags', () => {
    const mixedRows = [
      { Namespace: 'NS' },
      { Tag: 'DirectA' },
      { Category: 'Reviews', Tag: 'InReviews' },
      { Tag: 'DirectB' },
    ];
    const tree = parseTaxonomyTree(mixedRows);
    assert.deepEqual(serializeTaxonomyTree(tree), [
      {
        Namespace: 'NS', Category: '', Tag: '', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'DirectA', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'Reviews', Description: '',
      },
      {
        Namespace: '', Category: 'Reviews', Tag: 'InReviews', Description: '',
      },
      {
        Namespace: '', Category: '', Tag: 'DirectB', Description: '',
      },
    ]);
  });
});

describe('buildTaxonomySheet', () => {
  it('wraps rows in AEM\'s required single-sheet envelope', () => {
    const sheet = buildTaxonomySheet([{ Namespace: 'NS' }]);
    assert.equal(sheet[':type'], 'sheet');
    assert.deepEqual(sheet.columns, ['Namespace', 'Category', 'Tag', 'Description']);
    assert.equal(sheet.total, 1);
    assert.equal(sheet.limit, 1);
    assert.equal(sheet.offset, 0);
    assert.deepEqual(sheet.data, [{ Namespace: 'NS' }]);
  });
});
