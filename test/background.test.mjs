import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backgroundSource = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

function makeBackground(initial = {}) {
  let messageListener;
  const installListeners = {};
  const startupListeners = [];
  const state = structuredClone(initial);
  const getCalls = [];
  const chrome = {
    storage: { local: {
      async get(keys) {
        getCalls.push(keys);
        const wanted = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(wanted.filter(k => k in state).map(k => [k, structuredClone(state[k])]));
      },
      async set(values) { Object.assign(state, structuredClone(values)); },
    } },
    runtime: {
      onInstalled: { addListener(fn) { installListeners.onInstalled = fn; } },
      onStartup: { addListener(fn) { startupListeners.push(fn); } },
      onMessage: { addListener(fn) { messageListener = fn; } },
      lastError: null,
      getManifest: () => ({ version: '9.8.7' }),
      openOptionsPage() {}, reload() {},
    },
    commands: { onCommand: { addListener() {} } },
    tabs: { sendMessage() {}, query(_q, cb) { cb([]); } },
    webNavigation: { getAllFrames(_q, cb) { cb([]); } },
  };
  const context = vm.createContext({
    chrome, console, URL, URLSearchParams, Date, Math, Map, Set, Promise, AbortController, TypeError, Error, Object, Array, String, Number, RegExp, JSON,
    setTimeout, clearTimeout,
    importScripts(...paths) {
      for (const path of paths) {
        assert.ok(['core/text.js', 'runtime/context.js', 'learning/memory.js', 'learning/scoped-memory.js', 'diagnostics/diagnostics.js'].includes(path));
        const source = fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
        vm.runInContext(source, context, { filename: path });
      }
    },
    fetch() { throw new Error('network access is not part of these tests'); },
  });
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });
  async function send(message, sender = {}) {
    return new Promise(resolve => {
      const keepOpen = messageListener(message, sender, resolve);
      assert.equal(keepOpen, true);
    });
  }
  return { state, getCalls, installListeners, startupListeners, send };
}

test('seed initializes only default settings and never reads or replaces profile data', async () => {
  const profile = { fullName: 'Existing User', educations: [{ school: 'Existing School' }] };
  const harness = makeBackground({ profile, settings: undefined });
  await harness.installListeners.onInstalled();
  assert.deepEqual(harness.state.profile, profile);
  assert.deepEqual(harness.state.settings, { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', autoExpand: true });
  assert.deepEqual(harness.getCalls, ['settings']);
  assert.equal(harness.getCalls.some(keys => (Array.isArray(keys) ? keys : [keys]).some(k => /data|profile/i.test(k))), false);
});

test('concurrent DIAG messages are serialized without losing either record', async () => {
  const harness = makeBackground();
  const results = await Promise.all([
    harness.send({ type: 'DIAG', items: [{ stage: 'verify', reason: 'first', page: { host: 'one.example', path: '/' } }] }),
    harness.send({ type: 'DIAG', items: [{ stage: 'error', reason: 'second', page: { host: 'two.example', path: '/' } }] }),
  ]);
  assert.deepEqual(results.map(r => r.saved), [1, 1]);
  assert.equal(harness.state.diag.length, 2);
  assert.deepEqual(harness.state.diag.map(x => x.reason), ['first', 'second']);
});

test('MEM_SAVE records prior target in bounded history when the rule changes', async () => {
  const harness = makeBackground({ memories: { rule: { id: 'rule', to: '旧答案', updatedAt: 10, host: 'old.example', history: [{ to: '更早答案' }] } } });
  const response = await harness.send({ type: 'MEM_SAVE', items: [{ id: 'rule', to: '新答案', updatedAt: 20, host: 'new.example' }] });
  assert.equal(response.saved, 1);
  assert.equal(harness.state.memories.rule.to, '新答案');
  assert.deepEqual(harness.state.memories.rule.history[0], { to: '旧答案', at: 10, host: 'old.example' });
  assert.deepEqual(harness.state.memories.rule.history[1], { to: '更早答案' });
});

test('LEARN and REMEMBERED isolate sections and preserve legacy entries in storage', async () => {
  const question = '请描述你在该项目或校园活动中的具体贡献';
  const harness = makeBackground({ answers: { legacyAnswerKey: { label: question, section: '项目经历', row: 0, value: '旧项目回答', updatedAt: 1 } } });
  await harness.send({ type: 'LEARN', page: { host: 'example.test' }, items: [
    { label: question, section: '校园经历', row: 0, value: '校园活动回答' },
    { label: question, section: '项目经历', row: 0, value: '新项目回答' },
  ] });
  const result = await harness.send({ type: 'REMEMBERED', page: { host: 'example.test' }, fields: [
    { key: 'p', label: question, section: '项目经历', row: 0 },
    { key: 'c', label: question, section: '校园经历', row: 0 },
  ] });
  assert.equal(result.values.p, '新项目回答');
  assert.equal(result.values.c, '校园活动回答');
  assert.equal(Object.keys(harness.state.answers).length, 3);
});

test('cacheKey scopes resolved cache by host and profile revision', async () => {
  const field = { key: 'custom', label: '自定义长问题', section: '项目经历', row: 0, part: 0, kind: 'text', options: [] };
  const cache = { 'v2|["generic","one.example","project"]|7|项目经历|自定义长问题|0|0|text|': 'cached answer' };
  const harness = makeBackground({ cache, profileRev: 7 });
  const samePage = await harness.send({ type: 'RESOLVE', fields: [field], page: { host: 'one.example' } });
  const otherPage = await harness.send({ type: 'RESOLVE', fields: [field], page: { host: 'two.example' } });
  const newRevision = await makeBackground({ cache, profileRev: 8 }).send({ type: 'RESOLVE', fields: [field], page: { host: 'one.example' } });
  assert.equal(samePage.values.custom, 'cached answer');
  assert.equal(samePage.source.custom, '缓存');
  assert.notEqual(otherPage.values.custom, 'cached answer');
  assert.notEqual(newRevision.values.custom, 'cached answer');
});

test('DIAG_EXPORT returns sanitized records and does not expose quoted values or query data', async () => {
  const harness = makeBackground({ diag: [{
    platform: 'test', key: 'field-key', id: 'field-id', label: '字段', stage: 'error',
    reason: '资料“隐私内容”转换失败', at: '2026-01-01T00:00:00Z',
    page: { host: 'https://jobs.example.test', path: '/apply/12345?token=secret' },
  }] });
  const result = await harness.send({ type: 'DIAG_EXPORT' });
  assert.equal(result.version, '9.8.7');
  assert.equal(result.items[0].key, 'field-key');
  assert.equal(result.items[0].id, 'field-id');
  assert.equal(result.items[0].page.path, '/apply/:id');
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /隐私内容|token=secret/);
});

test('LEARN and REMEMBERED use stable company scope and reject legacy unscoped company answers', async () => {
  const pageA = { host: 'ehire.51job.com', path: '/apply', search: '?CTMID=tenant-a&resumeid=one' };
  const sameTenant = { host: 'ehire.51job.com', path: '/apply', search: '?ctmid=tenant-a&resumeid=two' };
  const otherTenant = { host: 'ehire.51job.com', path: '/apply', search: '?ctmid=tenant-b&resumeid=one' };
  const label = '您通过什么渠道获知本公司招聘';
  const harness = makeBackground({ answers: { old: { label, section: '申请信息', row: 0, value: 'legacy answer', updatedAt: 1 } } });
  await harness.send({ type: 'LEARN', page: pageA, items: [{ label, section: '申请信息', row: 0, value: 'tenant A answer' }] });
  const query = async page => harness.send({ type: 'REMEMBERED', page, fields: [{ key: 'q', label, section: '申请信息', row: 0 }] });
  assert.equal((await query(pageA)).values.q, 'tenant A answer');
  assert.equal((await query(sameTenant)).values.q, 'tenant A answer');
  assert.equal((await query(otherTenant)).values.q, undefined);
  assert.equal((await harness.send({ type: 'REMEMBERED', fields: [{ key: 'q', label, section: '申请信息', row: 0 }] })).values.q, undefined);
});
