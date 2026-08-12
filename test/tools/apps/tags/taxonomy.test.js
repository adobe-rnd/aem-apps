import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaxonomyTree,
  serializeTaxonomyTree,
  flattenTaxonomyTags,
  buildTaxonomySheet,
} from '../../../../tools/apps/tags/taxonomy.js';

// A namespace with a direct tag, a namespace mixing a direct tag with a
// categorized one (in either order), and a nested category — each Tag row
// carries its own Category, so order within a namespace doesn't matter.
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
});

describe('flattenTaxonomyTags', () => {
  it('produces the tags plugin\'s exact path convention for every leaf', () => {
    const tree = parseTaxonomyTree(rows);
    const paths = flattenTaxonomyTags(tree).map((t) => t.path);
    assert.deepEqual(paths, [
      'Article Types/Race Recap',
      'Tag Driven/Race Recap',
      'Tag Driven:catlev1/Alpha',
      'Tag Driven:catlev1/catlev2/Beta',
    ]);
  });
});

describe('serializeTaxonomyTree', () => {
  it('round-trips a tree byte-for-byte, omitting Category header rows implied by a Tag', () => {
    const tree = parseTaxonomyTree(rows);
    assert.deepEqual(serializeTaxonomyTree(tree), rows);
  });

  it('round-trips a category description alongside its tags', () => {
    const describedRows = [
      { Namespace: 'NS' },
      { Category: 'Cat', Description: 'cat desc' },
      { Category: 'Cat', Tag: 'Leaf' },
    ];
    const tree = parseTaxonomyTree(describedRows);
    assert.equal(tree.namespaces[0].children[0].description, 'cat desc');
    assert.deepEqual(serializeTaxonomyTree(tree), describedRows);
  });

  it('round-trips a namespace description', () => {
    const describedRows = [
      { Namespace: 'NS', Description: 'ns desc' },
      { Category: 'Cat', Tag: 'Leaf', Description: 'leaf desc' },
    ];
    const tree = parseTaxonomyTree(describedRows);
    assert.deepEqual(serializeTaxonomyTree(tree), describedRows);
  });

  it('preserves order when a direct tag is interleaved between categorized tags', () => {
    const mixedRows = [
      { Namespace: 'NS' },
      { Tag: 'DirectA' },
      { Category: 'Reviews', Tag: 'InReviews' },
      { Tag: 'DirectB' },
    ];
    const tree = parseTaxonomyTree(mixedRows);
    assert.deepEqual(serializeTaxonomyTree(tree), mixedRows);
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
