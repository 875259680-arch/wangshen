import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console, URL, URLSearchParams });
for (const file of ['text.js', 'memory.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../src/core/${file}`, import.meta.url), 'utf8'), ctx, { filename: file });
}
const Mem = ctx.AF.memory;

test('历史第二条自定义回答迁移保留 row，实习与正式工作隔离', () => {
  const old = { platform: 'moka', ident: 'label:实习经历/补充说明#1', from: null, to: '第二条实习说明', label: '补充说明', section: '实习经历', row: 1 };
  old.id = Mem.idOf(old);
  const store = { [old.id]: old };
  assert.equal(Mem.lookup(store, 'moka', { id: 123, label: old.label, section: '实习经历', row: 1 }, null), old.to);
  assert.equal(Mem.lookup(store, 'moka', { id: 123, label: old.label, section: '实习经历', row: 0 }, null), null);
  assert.equal(Mem.lookup(store, 'moka', { id: 123, label: old.label, section: '工作经历', row: 1 }, null), null);
});

test('同平台内置 id 在不同经历板块隔离，旧身份迁移读取校验板块与 row', () => {
  const old = { platform: 'job51', ident: 'id:colName', from: null, to: '项目名称', label: '名称', section: '项目经历', row: 0 };
  old.id = Mem.idOf(old);
  assert.equal(Mem.lookup({ [old.id]: old }, 'job51', { id: 'colName', label: '名称', section: '校园经历', row: 0 }, null), null);
  assert.equal(Mem.lookup({ [old.id]: old }, 'job51', { id: 'colName', label: '名称', section: '项目经验', row: 0 }, null), '项目名称');
  assert.equal(Mem.lookup({ [old.id]: old }, 'job51', { id: 'colName', label: '名称', section: '项目经历', row: 1 }, null), null);
});

test('新内置固定回答分板块并按 row 存储，转换记忆不分 row', () => {
  const base = { id: 'colName', label: '名称', platform: 'job51', section: '项目经历' };
  const fixed = Mem.make({ ...base, row: 0, after: '项目甲' }, 'job51.com');
  assert.notEqual(fixed.ident, Mem.make({ ...base, row: 1, after: '项目乙' }, 'job51.com').ident);
  assert.equal(Mem.lookup({ [fixed.id]: fixed }, 'job51', { ...base, row: 1 }, null), null);
  const mapped = Mem.make({ ...base, row: 0, from: '全日制', after: '统招全日制' }, 'job51.com');
  assert.equal(Mem.lookup({ [mapped.id]: mapped }, 'job51', { ...base, row: 5 }, '全日制'), '统招全日制');
});

test('自定义字段跨平台同名回答一致才复用，跨经历 row 不复用', () => {
  const f = { id: 'x_ext_1', label: '住宿类型', section: '基本信息', row: 0 };
  const a = Mem.make({ ...f, platform: 'beisen', after: '学校宿舍' }, 'a');
  const b = Mem.make({ ...f, platform: 'moka', after: '学校宿舍' }, 'b');
  assert.equal(Mem.lookup({ [a.id]: a }, 'moka', { ...f, id: 'other_ext_1' }, null), '学校宿舍');
  const c = Mem.make({ ...f, platform: 'hotjob', after: '校外租房' }, 'c');
  assert.equal(Mem.lookup({ [a.id]: a, [c.id]: c }, 'moka', f, null), null);
  assert.equal(Mem.lookup({ [a.id]: a, [b.id]: b }, 'moka', { ...f, row: 1 }, null), null);
});

test('基本信息与个人信息可兼容，项目、校园、未知板块保持隔离', () => {
  const personal = Mem.make({ platform: 'moka', id: 1, label: '宗教信仰', section: '个人信息', after: '无' }, 'a');
  const pStore = { [personal.id]: personal };
  assert.equal(Mem.lookup(pStore, 'beisen', { id: 2, label: '宗教信仰', section: '基本信息', row: 0 }, null), '无');
  const project = Mem.make({ platform: 'moka', id: 'x_ext', label: '职务', section: '项目经历', after: '负责人' }, 'a');
  assert.equal(Mem.lookup({ [project.id]: project }, 'moka', { ...project, section: '在校经历' }, null), null);
  const unknown = Mem.make({ platform: 'moka', id: 'u_ext', label: '住宿类型', section: '其他信息', after: '宿舍' }, 'a');
  assert.equal(Mem.lookup({ [unknown.id]: unknown }, 'beisen', { ...unknown, section: '基本信息' }, null), null);
});

test('新内置 identity 纳入 section；转换查询和 map 均隔离板块', () => {
  const a = { id: 'colName', label: '名称', platform: 'job51', section: '项目经历', row: 0 };
  const b = { ...a, section: '校园经历' };
  assert.notEqual(Mem.baseIdent(a), Mem.baseIdent(b));
  const conversion = Mem.make({ ...a, from: '相同资料值', after: '项目名' }, 'h');
  assert.equal(Mem.lookup({ [conversion.id]: conversion }, 'job51', b, '相同资料值'), null);
  const rule = Mem.makeMap(a, 'job51', 'project.name', 'AI', 'h');
  assert.deepEqual(JSON.parse(JSON.stringify(Mem.lookupMap({ [rule.id]: rule }, 'job51', a))), { list: 'project', prop: 'name' });
  assert.equal(Mem.lookupMap({ [rule.id]: rule }, 'job51', b), undefined);
});

test('旧版自定义 label identity 可按明确 section 类别迁移读取', () => {
  const old = { platform: 'beisen', ident: 'label:个人信息/住宿类型', from: null, to: '学校宿舍', label: '住宿类型', section: '个人信息', row: 0 };
  old.id = Mem.idOf(old);
  const store = { [old.id]: old };
  assert.equal(Mem.lookup(store, 'moka', { id: 'new_ext_22', label: '住宿类型', section: '基本信息', row: 0 }, null), '学校宿舍');
  assert.equal(Mem.lookup(store, 'moka', { id: 'new_ext_22', label: '住宿类型', section: '项目经历', row: 0 }, null), null);
});

test('51job cca/ccb/ccc/cce/ccf 数字 id 视为自定义字段，用板块和文字身份', () => {
  for (const id of ['cca123', 'ccb123', 'ccc123', 'cce123', 'ccf123']) {
    const a = Mem.make({ platform: 'job51', id, label: '自定义问项', section: '项目经历', after: '回答' }, 'h');
    assert.match(a.ident, /^label:/);
    assert.equal(Mem.lookup({ [a.id]: a }, 'job51', { id: `${id}x`, label: '自定义问项', section: '项目经历', row: 0 }, null), '回答');
    assert.equal(Mem.lookup({ [a.id]: a }, 'job51', { id: `${id}x`, label: '自定义问项', section: '校园经历', row: 0 }, null), null);
  }
});

test('公司相关固定回答按稳定公司 scope 隔离，忽略 51job resumeid/token 参数', () => {
  const pageA = { host: 'ehire.51job.com', path: '/apply', search: '?CTMID=CompanyA&resumeid=resume-1&token=token-1' };
  const sameCompany = { host: 'ehire.51job.com', path: '/apply', search: '?ctmid=CompanyA&resumeid=resume-2&token=token-2' };
  const pageB = { host: 'ehire.51job.com', path: '/apply', search: '?ctmid=CompanyB&resumeid=resume-1' };
  assert.equal(Mem.pageScope(pageA), Mem.pageScope(sameCompany));
  assert.notEqual(Mem.pageScope(pageA), Mem.pageScope(pageB));
  const f = { platform: 'job51', id: 'q_ext', label: '您通过什么渠道获知本公司招聘', section: '申请信息', row: 0 };
  const a = Mem.make({ ...f, scope: Mem.pageScope(pageA), after: '校园宣讲' }, 'ehire.51job.com');
  assert.ok(a.ident.includes('@scope:'));
  assert.equal(Mem.lookup({ [a.id]: a }, 'job51', { ...f, scope: Mem.pageScope(sameCompany) }, null), '校园宣讲');
  assert.equal(Mem.lookup({ [a.id]: a }, 'job51', { ...f, scope: Mem.pageScope(pageB) }, null), null);
  assert.equal(Mem.lookup({ [a.id]: a }, 'job51', f, null), null);
  const legacy = Mem.make({ ...f, after: '旧答案' }, 'ehire.51job.com');
  assert.equal(Mem.lookup({ [legacy.id]: legacy }, 'job51', { ...f, scope: Mem.pageScope(pageA) }, null), null);
});

test('Hotjob SU 租户和 Moka 招聘 slug 成为 scope，其他路径回退 host', () => {
  assert.equal(Mem.pageScope({ host: 'wecruit.hotjob.cn', path: '/SU12/web/apply' }), 'wecruit.hotjob.cn:su12');
  assert.equal(Mem.pageScope({ host: 'app.mokahr.com', path: '/campus_apply/Company-X/123' }), 'app.mokahr.com:company-x');
  assert.equal(Mem.pageScope({ host: 'app.mokahr.com', path: '/profile/resume-1', search: '?resumeid=resume-1' }), 'app.mokahr.com');
});

test('scope only applies to explicit company-dependent questions, not personal questions', () => {
  assert.equal(Mem.needsScope('您希望应聘本公司哪个岗位'), true);
  assert.equal(Mem.needsScope('您通过何种渠道获知招聘信息'), true);
  assert.equal(Mem.needsScope('住宿类型'), false);
  assert.equal(Mem.needsScope('宗教信仰'), false);
  const f = { platform: 'moka', id: 'x_ext', label: '宗教信仰', section: '个人信息', scope: 'tenant-a' };
  const m = Mem.make({ ...f, after: '无' }, 'a');
  assert.equal(m.scope, null);
  assert.equal(Mem.lookup({ [m.id]: m }, 'beisen', { ...f, scope: 'tenant-b' }, null), '无');
});

test('conversion and map identities require the same scope for company questions', () => {
  const a = { platform: 'job51', id: 'q_ext', label: '请选择本岗位的招聘渠道', section: '申请信息', scope: 'tenant-a' };
  const b = { ...a, scope: 'tenant-b' };
  const conversion = Mem.make({ ...a, from: '网络招聘', after: '官网' }, 'job51');
  assert.equal(Mem.lookup({ [conversion.id]: conversion }, 'job51', b, '网络招聘'), null);
  const rule = Mem.makeMap(a, 'job51', 'sem.channel', 'AI', 'job51');
  assert.deepEqual(JSON.parse(JSON.stringify(Mem.lookupMap({ [rule.id]: rule }, 'job51', a))), { list: 'sem', prop: 'channel' });
  assert.equal(Mem.lookupMap({ [rule.id]: rule }, 'job51', b), undefined);
});
