import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { readSchoolReferenceCatalog, normalizeSchoolReferences, REFERENCE_CATEGORIES } from '../src/project-references.mjs';

test('missing local catalog uses clearly labeled synthetic choices in all categories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hongson-catalog-test-'));
  try {
    const catalog = readSchoolReferenceCatalog(join(directory, 'missing.json'));
    assert.equal(catalog.isDemo, true);
    assert.equal(catalog.version, 'demo-example-1');
    assert.deepEqual(catalog.issues, []);
    assert.match(catalog.description, /ข้อมูลสมมติ/);
    assert.equal(new Set(catalog.items.map(item => item.id)).size, catalog.items.length);
    for (const item of catalog.items) {
      assert.ok(item.id.startsWith('demo:'));
      assert.match(item.name, /ตัวอย่างสมมติ ไม่ใช่ข้อมูลทางการ/);
      if (item.parentId) assert.equal(catalog.items.find(parent => parent.id === item.parentId)?.category, item.category);
    }
    const selections = Object.fromEntries(REFERENCE_CATEGORIES.filter(category => category !== 'strategy').map(category => {
      const leaves = catalog.items.filter(item => item.category === category && !catalog.items.some(child => child.parentId === item.id));
      assert.ok(leaves.length >= 2, category);
      return [category, [leaves[0].id]];
    }));
    const normalized = normalizeSchoolReferences({referenceSelections: selections}, {catalog, strict: true});
    assert.ok(normalized.referenceSelections.strategy[0].id.startsWith('demo:strategy:'));
  } finally {
    if (dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('hongson-catalog-test-')) rmSync(directory, {recursive: true, force: true});
  }
});

test('local catalog takes precedence and invalid local data never switches to demo choices', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hongson-catalog-test-'));
  const path = join(directory, 'catalog.json');
  try {
    const local = {schemaVersion: 1, version: 'test-local', items: [], sources: [], issues: []};
    writeFileSync(path, JSON.stringify(local));
    assert.deepEqual(readSchoolReferenceCatalog(path), local);
    for (const invalid of ['{broken', JSON.stringify({version: 'test-invalid'})]) {
      writeFileSync(path, invalid);
      const result = readSchoolReferenceCatalog(path);
      assert.equal(result.version, 'unavailable');
      assert.deepEqual(result.items, []);
      assert.equal(result.issues.length, 1);
      assert.equal(result.isDemo, undefined);
    }
  } finally {
    if (dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('hongson-catalog-test-')) rmSync(directory, {recursive: true, force: true});
  }
});
