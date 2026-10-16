import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console });
for (const file of ['text.js', 'regions-gb.js', 'region.js', 'convert.js', 'profile.js', 'mapping.js', '../adapters/job51/mapping.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../src/core/${file}`, import.meta.url), 'utf8'), ctx, { filename: file });
}
const J = ctx.AF.platforms.job51;
const fixture = JSON.parse(fs.readFileSync(new URL('./cases/job51/xuji-education.json', import.meta.url), 'utf8'));
const evidence = name => JSON.parse(fs.readFileSync(new URL(`./cases/job51/${name}.json`, import.meta.url), 'utf8'));
const field = label => fixture.fields.find(f => f.label === label);
const plain = value => JSON.parse(JSON.stringify(value));

test('经典地区字典优先使用独立列出的深圳入口', () => {
  const f = { id: 'CCE11', label: '第三志愿期望工作地', type: 'ss', options: ['广东省', '深圳'].map(text => ({ text, value: text })) };
  assert.deepEqual(plain(J.encode(f, '深圳市').raw), [['深圳'], ['深圳市', '深圳']]);
});

test('经典教育字段用可见教育步骤并将数字后缀映射到对应学历条目', () => {
  assert.deepEqual(plain(J.target(field('学历2'))), { list: 'edu', prop: 'degree', row: 1 });
  assert.deepEqual(plain(J.target(field('入学时间3'))), { list: 'edu', prop: 'start', row: 2 });
  assert.deepEqual(plain(J.target(field('毕业学校2'))), { list: 'edu', prop: 'school', row: 1 });
  assert.deepEqual(plain(J.target(field('专业3'))), { list: 'edu', prop: 'major', row: 2 });
});

test('editStyle 3 的只读教育日期按 YYYY-MM-DD 编码', () => {
  const f = field('入学时间2');
  assert.equal(J.kind(f), 'date');
  assert.deepEqual(plain(J.encode(f, '2025-9').raw), ['2025-09-01']);
  assert.deepEqual(plain(J.encode(field('毕业时间'), '2027-06-30').raw), ['2027-06-30']);
});

test('所有 editStyle 3 文本框按日期编码，IDCard 双控件只写证件号码', () => {
  const birthday = { id: 'Birthday', label: '出生日期', type: 't', editStyle: '3' };
  assert.equal(J.kind(birthday), 'date');
  assert.deepEqual(plain(J.encode(birthday, '2001-5-11').raw), ['2001-05-11']);
  const card = { id: 'IDCard', label: '身份证号码', type: 'st' };
  assert.equal(J.kind(card), 'identity');
  assert.deepEqual(plain(J.target(card)), { sem: 'idNumber' });
  assert.deepEqual(plain(J.encode(card, '110101200105110011').raw), [null, '110101200105110011']);
});

test('经典字段问法表覆盖志愿工作地、通信地址和紧急联系方式', () => {
  for (const label of ['第一志愿期望工作地', '第二志愿期望工作地', '第三志愿期望工作地']) {
    assert.deepEqual(plain(J.target({ id: 'TargetCity', label, type: 'ss' })), { sem: 'cityPref' });
  }
  assert.deepEqual(plain(J.target({ id: 'Address', label: '通信地址', type: 't' })), { sem: 'address' });
  assert.deepEqual(plain(J.target({ id: 'Emergency', label: '紧急联系方式', type: 'st' })), { sem: 'emergencyPhone' });
});

test('学校与专业编码为精确级联搜索，不做模糊候选', () => {
  const school = J.encode(field('毕业学校2'), '上海理工大学');
  assert.deepEqual(plain(school.raw), [null, { search: '上海理工大学', parent: true }]);
  const major = J.encode(field('专业2'), '物流工程与管理');
  assert.deepEqual(plain(major.raw), [null, { search: '物流工程与管理', parent: true }]);
  const dictionary = { ...field('专业2'), type: 's', options: [
    { text: '市场营销（工商管理类）', value: '1' }, { text: '物流管理', value: '2' },
  ] };
  assert.deepEqual(plain(J.encode(dictionary, '市场营销').raw), [['市场营销（工商管理类）']]);
  assert.match(J.encode(dictionary, '物流工程与管理').error, /没有唯一的精确匹配/);
});

test('same 对 search 做精确比较，对 num 验证档位区间', () => {
  const professional = { label: '专业' };
  assert.equal(J.same(professional, ['市场营销（工商管理类）'], [[{ search: '市场营销' }]]), true);
  assert.equal(J.same(professional, ['物流管理'], [[{ search: '物流工程与管理' }]]), false);
  const score = { label: '英语水平' };
  assert.equal(J.same(score, ['CET6 425-550分'], [[{ num: 525 }]]), true);
  assert.equal(J.same(score, ['CET6 425-550分'], [[{ num: 600 }]]), false);
});

test('真实语言页英语字段保留等级选择与分数档位请求', () => {
  const { fields } = evidence('classic-language');
  const f = fields.find(x => x.id === 'EnglishLevel');
  assert.equal(J.kind(f), 'select2');
  assert.deepEqual(f.options.map(x => x.text), ['大学英语4级(CET4)', '大学英语6级(CET6)', '英语专业4级', '英语专业8级', '托福(TOEFL)', '雅思(IELTS)', '其他', '无']);
  assert.deepEqual(plain(J.encode(f, '六级', { facts: { englishScore: '525' } }).raw), [['大学英语6级(CET6)'], [{ num: 525 }]]);
  assert.deepEqual(plain(J.encode(f, '六级').raw), [['大学英语6级(CET6)'], null]);
});

test('真实技能、奖励和证书文字字段映射到对应单值资料', () => {
  const skill = evidence('classic-skills').fields[0];
  const awards = evidence('classic-certificates').fields.find(f => f.label === '所获奖励或荣誉情况');
  const certificates = evidence('classic-certificates').fields.find(f => f.label === '所获证书');
  assert.deepEqual(plain(J.target(skill)), { sem: 'skills' });
  assert.deepEqual(plain(J.target(awards)), { sem: 'awards' });
  assert.deepEqual(plain(J.target(certificates)), { sem: 'certificatesText' });
});

test('真实科研项目字段日期和名称映射按 row 读不同事实', () => {
  const { fields } = evidence('classic-projects');
  const by = (label, row) => fields.find(f => f.label === label && f.row === row);
  const start0 = by('开始日期', 0), end1 = by('结束日期', 1);
  const name0 = by('科研项目名称', 0), name1 = by('科研项目名称', 1);
  assert.equal(J.kind(start0), 'date');
  assert.deepEqual(plain(J.target(start0)), { list: 'project', prop: 'start' });
  assert.deepEqual(plain(J.target(end1)), { list: 'project', prop: 'end' });
  assert.deepEqual(plain(J.target(name0)), { list: 'project', prop: 'name' });
  const facts = ctx.AF.profile.facts({ projects: [
    { name: '项目甲', startDate: '2023-01', endDate: '2023-08' },
    { name: '项目乙', startDate: '2024-02', endDate: '2024-11' },
  ] });
  assert.equal(ctx.AF.mapping.valueOf(J.target(name0), facts, name0.row), '项目甲');
  assert.equal(ctx.AF.mapping.valueOf(J.target(name1), facts, name1.row), '项目乙');
  assert.equal(J.encode(start0, ctx.AF.mapping.valueOf(J.target(start0), facts, start0.row)).raw[0], '2023-01-01');
});

test('重复专业子项只有测试构造 children 可覆盖：资料类别唯一消歧，缺项走其他并保留原名', () => {
  // Capture did not include live D_Major child rows; these synthetic rows exercise the branch only.
  const f = { id: 'Major', label: '专业', type: 'ss', groupTitle: '教育经历', row: 0, options: [
    { text: '工商管理类（管理学）', children: [{ text: '市场营销', value: 'a' }, { text: '工商管理类-其他', value: 'c' }] },
    { text: '市场营销类（其他门类）', children: [{ text: '市场营销', value: 'b' }] },
  ] };
  const facts = { lists: { edu: [{ majorCategory: '工商管理类' }] } };
  assert.deepEqual(plain(J.encode(f, '市场营销', { facts }).raw), [['工商管理类（管理学）'], ['市场营销']]);
  const companion = { key: 'OtherMajor|1|0', label: '其他专业', row: 0 };
  const fallback = J.encode(f, '物流工程与管理', { facts, fields: [companion] });
  assert.deepEqual(plain(fallback.raw), [['工商管理类（管理学）'], ['工商管理类-其他']]);
  assert.deepEqual(plain(fallback.additional), [{ key: companion.key, raw: ['物流工程与管理'], value: '物流工程与管理' }]);
});

test('真实社会实践字段按实习/工作经历读取，兼职/全职选项不替实习猜工作类型', () => {
  const { fields } = evidence('classic-social-practice');
  const f = (label, row = 0) => fields.find(x => x.label === label && x.row === row);
  assert.equal(J.listOf(f('开始日期')), 'workOrIntern');
  assert.deepEqual(plain(J.target(f('工作单位'))), { list: 'workOrIntern', prop: 'company' });
  assert.deepEqual(plain(J.target(f('职位'))), { list: 'workOrIntern', prop: 'title' });
  assert.deepEqual(plain(J.target(f('社会实践内容描述'))), { list: 'workOrIntern', prop: 'desc' });
  assert.deepEqual(plain(J.target(f('部门'))), { list: 'workOrIntern', prop: 'department' });
  assert.equal(f('部门').required, false);
  assert.deepEqual(plain(J.encode(f('工作类型'), '实习')), { skip: '网站只提供兼职/全职，资料只有实习，无法确定工作类型' });
  assert.deepEqual(plain(J.encode(f('开始日期'), '至今', { today: '2026-10-16' })), { raw: ['2026-10-16'], note: '网页日期框没有至今选项，已填今天' });
});

test('真实校园实践字段映射 campus 描述、类型和日期', () => {
  const { fields } = evidence('classic-campus');
  const f = label => fields.find(x => x.label === label);
  assert.equal(J.listOf(f('校园实践内容描述')), 'campus');
  assert.deepEqual(plain(J.target(f('校园实践内容描述'))), { list: 'campus', prop: 'desc' });
  assert.deepEqual(plain(J.target(f('校园实践经历类型'))), { list: 'campus', prop: 'category' });
  assert.equal(J.kind(f('开始日期')), 'date');
  assert.equal(J.encode(f('结束日期'), '2024-06').raw[0], '2024-06-01');
});

test('真实其他页文件字段和 Family/WillingAssign 单值映射', () => {
  const { fields } = evidence('classic-other-uploads');
  for (const f of fields.filter(x => x.type === 'file')) assert.equal(J.kind(f), 'file');
  assert.deepEqual(plain(J.target(fields.find(x => x.id === 'Family'))), { sem: 'declareNo' });
  assert.deepEqual(plain(J.target(fields.find(x => x.id === 'WillingAssign'))), { sem: 'acceptAdjustment' });
});
