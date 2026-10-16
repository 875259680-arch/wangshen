import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/diagnostics/diagnostics.js';

const diag = globalThis.AF.diag;

test('sanitizePath removes query strings and masks obvious user ids', () => {
  assert.equal(diag.sanitizePath('/jobs/12345/apply?name=secret'), '/jobs/:id/apply');
  assert.equal(diag.sanitizePath('/user/550e8400-e29b-41d4-a716-446655440000/profile'), '/user/:id/profile');
});

test('sanitizeReason removes quoted values and common personal data', () => {
  const reason = diag.sanitizeReason('资料“张三”无法填写，联系 zhang@example.com 或 13800138000');
  assert.doesNotMatch(reason, /张三|zhang@example\.com|13800138000/);
  assert.match(reason, /\[资料值\]/);
});

test('sanitizeReason redacts unquoted profile city preferences and upload filenames', () => {
  const city = diag.sanitizeReason('你的意向城市：上海、深圳；网页选项只有：北京、广州。请自己选');
  assert.doesNotMatch(city, /上海|深圳/);
  assert.match(city, /网页选项只有：北京、广州/);

  const upload = diag.sanitizeItem({
    stage: 'upload', label: '简历附件', reason: '上传失败：无法读取 /Users/alice/private_resume_李明.pdf，请检查文件',
    page: { host: 'jobs.example.test', path: '/' },
  });
  assert.doesNotMatch(upload.reason, /alice|private_resume|李明|\.pdf/);
  assert.match(upload.reason, /\[文件名\]/);
  assert.equal(upload.stage, 'upload');
  assert.equal(upload.label, '简历附件');
});

test('aggregate groups by sanitized host and path and counts outcomes', () => {
  const groups = diag.aggregate([
    { page: { host: 'https://jobs.example.com', path: '/user/123/apply?x=1' }, at: '2026-01-01T00:00:00Z', stage: 'dom', label: '电话', section: '基本资料', reason: '无法填写' },
    { page: { host: 'jobs.example.com', path: '/user/456/apply' }, at: '2026-01-02T00:00:00Z', stage: 'unmapped', label: '学校', reason: '无对应资料' },
    { page: { host: 'jobs.example.com', path: '/user/456/apply' }, at: '2026-01-03T00:00:00Z', stage: 'ai', label: '自我介绍', reason: '由 AI 回答' },
    { page: { host: 'jobs.example.com', path: '/user/456/apply' }, at: '2026-01-04T00:00:00Z', stage: 'future-stage', label: '其它', reason: '记录' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].path, '/user/:id/apply');
  assert.equal(groups[0].failCount, 1);
  assert.equal(groups[0].unmappedCount, 1);
  assert.equal(groups[0].aiCount, 1);
  assert.equal(groups[0].otherCount, 1);
  assert.equal(groups[0].failCount, 1);
  assert.equal(groups[0].fields.length, 4);
  const item = diag.sanitizeItem({ key: 'field-key', id: 'field-id', page: { host: 'jobs.example.com', path: '/' }, reason: '无法填写' });
  assert.equal(item.key, 'field-key');
  assert.equal(item.id, 'field-id');
});
