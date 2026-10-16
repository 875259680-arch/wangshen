import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console });
for (const file of ['text.js', 'regions-gb.js', 'region.js', 'convert.js', 'profile.js', 'mapping.js', 'platform-beisen.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../src/core/${file}`, import.meta.url), 'utf8'), ctx, { filename: file });
}
const B = ctx.AF.platforms.beisen;
const data = JSON.parse(fs.readFileSync(new URL('./cases/beisen/poly-20261016.json', import.meta.url), 'utf8'));
const plain = x => JSON.parse(JSON.stringify(x));
const fields = data.fields;
const byId = (id, row = 0) => fields.find(f => f.id === id && f.row === row);

test('真实科研实践项目标题将复用的 Practice block 映射到 project，普通旧块仍是 campus', () => {
  const title = byId('RecruitmentSchoolPractice_PracticeName');
  assert.equal(title.label, '在校科研及实践项目');
  // The page adapter propagates this explicit title classification to every sibling in the block.
  const projectField = f => ({ ...f, listKind: 'project' });
  assert.equal(B.listOf(projectField(title)), 'project');
  assert.deepEqual(plain(B.target(projectField(title))), { list: 'project', prop: 'name' });
  assert.deepEqual(plain(B.target(projectField(byId('RecruitmentSchoolPractice_PracticeDescription')))), { list: 'project', prop: 'desc' });
  assert.deepEqual(plain(B.target(projectField(byId('RecruitmentSchoolPractice_PracticeStartDateTime')))), { list: 'project', prop: 'start' });
  assert.deepEqual(plain(B.target(projectField(byId('RecruitmentSchoolPractice_PracticeEndDateTime')))), { list: 'project', prop: 'end' });
  assert.deepEqual(plain(B.target(projectField(byId('RecruitmentSchoolPractice_extdrjs824_101193_1947179812')))), { list: 'project', prop: 'role' });
  assert.equal(B.listOf(title), 'campus');
  assert.equal(B.addArg(title), '在校实践');
});

test('真实专业课程字段属于 education.courses，不会落入项目描述', () => {
  const f = byId('RecruitmentApplicantEducation_MajorCourses');
  assert.equal(f.label, '专业课程');
  assert.deepEqual(plain(B.target(f)), { list: 'edu', prop: 'courses' });
});

test('真实专业人数明确读取 edu.majorSize，不从 GPA 推断并拒绝小数', () => {
  const headcount = fields.find(f => f.label === '专业人数');
  assert.equal(headcount.type, 'BC_DigitText');
  assert.deepEqual(plain(B.target(headcount)), { list: 'edu', prop: 'majorSize' });
  assert.deepEqual(plain(B.target({ ...headcount, row: 1 })), { list: 'edu', prop: 'majorSize' });

  const noSize = ctx.AF.profile.facts({ educations: [{ gpa: '3.7' }] });
  assert.equal(noSize.lists.edu[0].gpa, '3.7');
  assert.equal(noSize.lists.edu[0].majorSize, '');
  assert.equal(ctx.AF.mapping.valueOf(B.target(headcount), noSize, headcount.row), '');

  const supplied = ctx.AF.profile.facts({ educations: [{ gpa: '3.7', majorSize: '120' }] });
  assert.equal(ctx.AF.mapping.valueOf(B.target(headcount), supplied, headcount.row), '120');
  assert.deepEqual(plain(B.encode(headcount, '120').raw), { text: '120', value: '120' });
  assert.match(B.encode(headcount, '3.7').error, /正整数/);
  assert.match(B.encode(headcount, '0').error, /正整数/);
});

test('论文名称读取 publication，未知板块的 Name 不读取本人姓名', () => {
  assert.deepEqual(plain(B.target(byId('RecruitmentWritings_WritingsTitle'))), { list: 'publication', prop: 'name' });
  assert.deepEqual(plain(B.target(byId('RecruitmentWritings_WritingsPublishDate'))), { list: 'publication', prop: 'date' });
  assert.equal(B.target({ id: 'UnknownBlock_Name', label: '名称' }), null);
});

test('日期回读兼容 yyyy/MM 与 yyyy/MM/dd 的默认 1 日，保留明确日差异', () => {
  const f = { type: 'BC_DateTime', format: 'yyyy/MM/dd' };
  assert.equal(B.same(f, { value: '2024/06/01' }, { value: '2024/06' }), true);
  assert.equal(B.same(f, { value: '2024/06' }, { value: '2024/06/01' }), true);
  assert.equal(B.same(f, { value: '2024/06/02' }, { value: '2024/06' }), false);
  assert.equal(B.same(f, { value: '2024/06/02' }, { value: '2024/06/03' }), false);
  assert.equal(B.same(f, { value: '2024/06/01' }, { value: '2024/07' }), false);
});
