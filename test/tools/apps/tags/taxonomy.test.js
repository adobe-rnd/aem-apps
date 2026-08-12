import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaxonomyTree,
  serializeTaxonomyTree,
  flattenTaxonomyTags,
} from '../../../../tools/apps/tags/taxonomy.js';

// Mirrors the tags plugin's original doc-comment example: a namespace with a
// direct tag, a namespace with a category, and a nested category.
const rows = [
  { Namespace: 'Article Types' },
  { Tag: 'Race Recap', Description: 'A recap of a race' },
  { Namespace: 'Tag Driven' },
  { Tag: 'Race Recap' },
  { Category: 'catlev1' },
  { Tag: 'Alpha' },
  { Category: 'catlev1/catlev2' },
  { Tag: 'Beta', Description: 'Beta desc' },
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

  it('reads Description on Namespace/Category rows too, not just Tag', () => {
    const describedRows = [
      { Namespace: 'NS', Description: 'ns desc' },
      { Category: 'Cat', Description: 'cat desc' },
      { Tag: 'Leaf', Description: 'leaf desc' },
    ];
    const tree = parseTaxonomyTree(describedRows);
    assert.equal(tree.namespaces[0].description, 'ns desc');
    assert.equal(tree.namespaces[0].children[0].description, 'cat desc');
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
  it('round-trips a tree with no leaf/category interleaving byte-for-byte', () => {
    const cleanRows = [
      { Namespace: 'Article Types' },
      { Tag: 'Race Recap', Description: 'A recap of a race' },
      { Namespace: 'Tag Driven' },
      { Category: 'catlev1' },
      { Tag: 'Alpha' },
      { Category: 'catlev1/catlev2' },
      { Tag: 'Beta', Description: 'Beta desc' },
    ];
    const tree = parseTaxonomyTree(cleanRows);
    assert.deepEqual(serializeTaxonomyTree(tree), cleanRows);
  });

  it('round-trips namespace/category descriptions', () => {
    const describedRows = [
      { Namespace: 'NS', Description: 'ns desc' },
      { Category: 'Cat', Description: 'cat desc' },
      { Tag: 'Leaf', Description: 'leaf desc' },
    ];
    const tree = parseTaxonomyTree(describedRows);
    assert.deepEqual(serializeTaxonomyTree(tree), describedRows);
  });

  it('re-groups a leaf that was interleaved before a sub-category, but stays equivalent', () => {
    // The input above puts a direct tag ("Race Recap") before a sub-category
    // ("catlev1") under "Tag Driven" — serialization always emits a node's
    // own leaves before its sub-categories, so re-parsing the serialized
    // output must still resolve to the same tree, even though the raw rows
    // aren't byte-identical to the input.
    const tree = parseTaxonomyTree(rows);
    const reparsed = parseTaxonomyTree(serializeTaxonomyTree(tree));
    assert.deepEqual(reparsed, tree);
  });
});
