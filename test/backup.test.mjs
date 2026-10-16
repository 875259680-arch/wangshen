import test from 'node:test';
import assert from 'node:assert/strict';
import backup from '../src/core/backup.js';

const completeData = () => ({
  profile: { name: '示例', experiences: ['A', 'B'] },
  answers: { q1: { value: '是', updatedAt: 12 } },
  memories: { m1: { from: 'A', to: 'B', history: [{ at: 1 }] } },
  supplement: { GPA: { value: '3.8' } },
  files: { 简历: { name: 'resume.pdf', base64: 'AA==' } },
  settings: { apiKey: 'secret', model: 'example' },
  resume: { name: 'old.pdf', base64: 'AQ==' },
  photo: { name: 'old.jpg', base64: 'Ag==' },
  profileRev: 42,
  cache: { item: 'cached' },
  picks: { item: 'choice' },
  seedVersion: 7,
});

test('build and parse round-trip the complete backup without losing history or API key', () => {
  const data = completeData();
  const result = backup.parse(JSON.stringify(backup.build(data, {
    extensionVersion: '3.7.0', exportedAt: '2026-10-15T12:00:00.000Z',
  })));
  assert.deepEqual(result, {
    schemaVersion: 1,
    app: 'wangshen-autofill',
    extensionVersion: '3.7.0',
    exportedAt: '2026-10-15T12:00:00.000Z',
    data,
  });
});

test('API key is included by default and can be excluded explicitly', () => {
  assert.equal(backup.build(completeData()).data.settings.apiKey, 'secret');
  assert.equal(backup.build(completeData(), { includeApiKey: false }).data.settings.apiKey, '');
});

test('legacy app/version/data backups parse and prepare a complete replacement payload', () => {
  const legacy = { app: 'wangshen-autofill', version: '2.4.0', exportedAt: '2026-01-02T03:04:05Z', data: { answers: { a: { history: [1] } } } };
  const parsed = backup.parse(legacy);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.extensionVersion, '2.4.0');
  assert.deepEqual(parsed.data.answers, legacy.data.answers);

  const payload = backup.prepareImport(legacy);
  assert.deepEqual(Object.keys(payload).sort(), [...backup.dataKeys].sort());
  assert.deepEqual(payload.answers, legacy.data.answers);
  assert.deepEqual(payload.profile, {});
  assert.deepEqual(payload.settings, {});
  assert.deepEqual(payload.files, {});
  assert.deepEqual(payload.cache, {});
  assert.deepEqual(payload.picks, {});
  assert.equal(payload.profileRev, 0);
  assert.equal(payload.seedVersion, Number.MAX_SAFE_INTEGER);
});

test('empty new-machine state exports and imports with safe defaults', () => {
  const payload = backup.prepareImport(backup.build({}, { extensionVersion: '3.7.0' }));
  for (const key of ['profile', 'answers', 'memories', 'supplement', 'files', 'settings', 'resume', 'photo', 'cache', 'picks']) {
    assert.deepEqual(payload[key], {});
  }
  assert.equal(payload.profileRev, 0);
  assert.equal(payload.seedVersion, Number.MAX_SAFE_INTEGER);
});

test('rejects malformed JSON, wrong top-level types, invalid metadata, and unknown data keys', () => {
  assert.throws(() => backup.parse('{'), /有效 JSON/);
  assert.throws(() => backup.parse([]), /对象/);
  assert.throws(() => backup.parse({ app: 'other', schemaVersion: 1, extensionVersion: '1', exportedAt: '2026-01-01', data: {} }), /不是网申助手/);
  assert.throws(() => backup.parse({ app: 'wangshen-autofill', schemaVersion: 2, extensionVersion: '1', exportedAt: '2026-01-01', data: {} }), /不支持/);
  assert.throws(() => backup.parse({ app: 'wangshen-autofill', version: '1', exportedAt: '2026-01-01', data: { answers: [], unknown: true } }), /未知字段/);
  assert.throws(() => backup.parse({ app: 'wangshen-autofill', version: '1', exportedAt: '2026-01-01', data: { files: [] } }), /data.files 必须是对象/);
  assert.throws(() => backup.parse({ app: 'wangshen-autofill', version: '1', exportedAt: '2026-01-01', data: { answers: { q: [] } } }), /data.answers.q 必须是对象/);
  assert.throws(() => backup.parse({ app: 'wangshen-autofill', version: '1', exportedAt: '2026-01-01', data: { profileRev: '1' } }), /profileRev 必须是非负数/);
  assert.throws(() => backup.parse({ app: 'wangshen-autofill', version: '1', exportedAt: '2026-01-01', data: { settings: { apiKey: 123 } } }), /apiKey 必须是字符串/);
});
