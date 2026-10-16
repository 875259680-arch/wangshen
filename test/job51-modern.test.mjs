import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console });
for (const file of ['text.js', 'convert.js', 'profile.js', 'mapping.js', '../adapters/job51v/mapping.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../src/core/${file}`, import.meta.url), 'utf8'), ctx, { filename: file });
}
const AF = ctx.AF, J = AF.platforms.job51v;
const fixture = JSON.parse(fs.readFileSync(new URL('./cases/job51/hengao-conditional.json', import.meta.url), 'utf8'));
const field = (group, label) => fixture.fields.find(f => f.groupTitle === group && f.label === label);
const plain = v => JSON.parse(JSON.stringify(v));

test('真实教育2/3字段定位到各自教育条目', () => {
  assert.deepEqual(plain(J.target(field('教育经历2', '学历层次2'))), { list: 'edu', prop: 'degree', row: 1 });
  assert.deepEqual(plain(J.target(field('教育经历2', '入学时间2'))), { list: 'edu', prop: 'start', row: 1 });
  assert.deepEqual(plain(J.target(field('教育经历3', '毕业时间3'))), { list: 'edu', prop: 'end', row: 2 });
  assert.deepEqual(plain(J.target(field('教育经历3', '毕业学校3'))), { list: 'edu', prop: 'school', row: 2 });
  assert.deepEqual(plain(J.target(field('教育经历3', '专业3'))), { list: 'edu', prop: 'major', row: 2 });
});

test('校园、实习 presence 与描述字段分别映射到对应资料列表', () => {
  assert.deepEqual(plain(J.target(field('校园经历', '是否有校园经历'))), { sem: 'has_campus', perRow: true });
  assert.deepEqual(plain(J.target(field('实习/工作经验', '是否有实习/工作经验'))), { sem: 'has_workOrIntern', perRow: true });
  assert.deepEqual(plain(J.target(field('校园经历', '担任职务'))), { list: 'campus', prop: 'role' });
  assert.deepEqual(plain(J.target(field('校园经历', '贡献描述'))), { list: 'campus', prop: 'desc' });
  assert.deepEqual(plain(J.target(field('实习/工作经验', '职位'))), { list: 'workOrIntern', prop: 'title' });
  assert.deepEqual(plain(J.target(field('实习/工作经验', '工作描述'))), { list: 'workOrIntern', prop: 'desc' });
});

test('论文开关只取 publication facts；不把项目资料当论文', () => {
  const f = field('学术成果/发表论文', '是否有学术成果/发表论文');
  assert.deepEqual(plain(J.target(f)), { sem: 'has_publication', perRow: true });
  const facts = AF.profile.facts({ projects: [{ name: '项目甲' }], publications: [] });
  assert.equal(facts.has_publication, '否');
  assert.equal(facts.lists.publication.length, 0);
  assert.equal(facts.lists.project.length, 1);
});

test('英语级联用子选项分数档位选择', () => {
  const f = { ...field('外语能力', '英语水平'), options: [
    { text: '大学英语6级(CET6)', value: '0200', children: [
      { text: 'CET6 425-550分', value: '0201' },
      { text: 'CET6 550分以上', value: '0202' },
    ] },
  ] };
  assert.equal(J.kind(f), 'cascade');
  assert.equal(J.encode(f, '六级', { facts: { englishScore: '525' } }).raw, '0201');
  assert.equal(J.encode(f, '六级', { facts: { englishScore: '600' } }).raw, '0202');
  assert.match(J.encode(f, '六级', { facts: { englishScore: '' } }).error, /成绩档位/);
});

test('es18 专业只认同名项，不把物流工程与管理近似成物流管理', () => {
  const f = field('最高学历', '专业');
  assert.equal(J.kind(f), 'select');
  const result = J.encode(f, '物流工程与管理');
  assert.equal(result.raw, undefined);
  assert.match(result.error, /没有同名条目/);
  assert.equal(f.options.some(o => o.text === '物流工程与管理'), false);
});

test('教育和经历日期可编码；工作时长由 profile 派生', () => {
  const date = field('教育经历2', '入学时间2');
  assert.equal(J.kind(date), 'date');
  assert.equal(J.encode(date, '2022-09').raw, '2022-09-01 00:00:00');
  const facts = AF.profile.facts({
    educations: [{ startDate: '2022-09', endDate: '2026-06' }, { startDate: '2018-09', endDate: '2022-06' }],
    internships: [{ startDate: '2025-01', endDate: '2025-04', title: '实习生', description: '描述' }],
    campusExperiences: [{ role: '负责人', description: '贡献' }],
    projects: [{ name: '项目甲' }],
    publications: [],
  });
  assert.equal(facts.lists.intern[0].duration, '3个月');
  assert.equal(facts.has_campus, '是');
  assert.equal(facts.has_publication, '否');
  assert.equal(facts.has_project, '是');
});

test('原始 UI 与字典值不一致时不报告 same', () => {
  const f = { ...field('最高学历', '专业'), uiMatchesRaw: false };
  assert.equal(J.same(f, '工商管理类-其他', '工商管理类-其他'), false);
  assert.equal(J.same({ ...f, uiMatchesRaw: true }, '工商管理类-其他', '工商管理类-其他'), true);
});

test('现代专业选项按 education.discipline 在同名候选中选唯一门类', () => {
  // Captured D_MAJOR exposes one matching market-major item. Duplicate candidates
  // below are synthetic and exercise the category disambiguation branch explicitly.
  const captured = field('最高学历', '专业');
  const exactCaptured = J.encode(captured, '市场营销', { facts: { lists: { edu: [{ discipline: '管理学' }] } } });
  assert.equal(exactCaptured.raw, '0302');
  const duplicates = { ...captured, options: [
    { text: '市场营销（管理学）', value: 'management' },
    { text: '市场营销（专科）', value: 'vocational' },
  ] };
  const picked = J.encode(duplicates, '市场营销', { facts: { lists: { edu: [{ discipline: '管理学' }] } } });
  assert.equal(picked.raw, 'management');
  assert.ok(J.encode(duplicates, '市场营销').error, '缺少 discipline 时不应任意选其中一个');
});

test('initialize 请求补齐未保存的多条经历，但固定教育卡不追加', async () => {
  const calls = [];
  const sections = [
    { group: 'edu2', title: '教育经历2', multi: false, count: 1 },
    { group: 'campus', title: '校园经历', multi: true, count: 0 },
  ];
  const switchField = field('校园经历', '是否有校园经历');
  AF.rpc = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'sections') return sections;
    if (method === 'openSections') return (payload || []).map(x => ({ group: x.group, ok: true }));
    if (method === 'list') return [{ ...switchField, raw: null }];
    if (method === 'writeMany') return (payload || []).map(x => ({ key: x.key, ok: true }));
    throw new Error(`unexpected RPC ${method}`);
  };
  const facts = AF.profile.facts({
    educations: [{ school: '甲校' }, { school: '乙校' }, { school: '丙校' }],
    campusExperiences: [{ organization: '社团甲' }, { organization: '社团乙' }],
  });
  await J.initialize(facts, { overwrite: true });
  const openCall = calls.find(x => x.method === 'openSections');
  assert.ok(openCall);
  const edu = openCall.payload.find(x => x.group === 'edu2');
  const campus = openCall.payload.find(x => x.group === 'campus');
  assert.equal(edu.add, undefined);
  assert.equal(campus.add, true);
  const writes = calls.find(x => x.method === 'writeMany');
  assert.equal(writes.payload[0].key, switchField.key);
  assert.equal(writes.payload[0].raw, '是');
});
