// 核心层单测：用真实申请页抓下来的字段清单（test/cases/）驱动，不开浏览器。
// 跑法：在项目根目录运行 node --test（一秒内结束）
// 新平台 / 新失败：把诊断导出的字段放进 cases/<平台>/，在这里加一条“这个字段应该对应到什么、写成什么”。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = f => fs.readFileSync(path.join(here, '../src/core', f), 'utf8');
const ctx = vm.createContext({ console });
for (const f of ['text.js', 'regions-gb.js', 'region.js', 'convert.js', 'profile.js', 'mapping.js', '../learning/memory.js', '../adapters/moka/mapping.js', '../adapters/beisen/mapping.js', '../adapters/hotjob/mapping.js', '../adapters/feishu/mapping.js', '../adapters/job51/mapping.js', '../adapters/job51v/mapping.js']) vm.runInContext(src(f), ctx, { filename: f });
const AF = ctx.AF;
const cases = p => JSON.parse(fs.readFileSync(path.join(here, 'cases', p), 'utf8'));
const plain = x => JSON.parse(JSON.stringify(x));

// 虚构资料（结构与真实资料相同）
const profile = {
  personal: { fullName: '测试候选人', gender: '男', birthDate: '2001-05-11', ethnicity: '汉族', politicalStatus: '群众', maritalStatus: '未婚', phoneNumber: '13000000000', email: 'a@example.invalid' },
  contactAndLocation: { hometownCity: '内蒙古自治区/赤峰市/红山区', currentCity: '上海', sourceLocation: '上海市/黄浦区', hukouLocation: '内蒙古自治区/赤峰市/红山区' },
  identityAndAuthorization: { driversLicense: '有', driversLicenseType: 'C1' },
  educations: [{ school: '上海理工大学', degree: '硕士', major: '物流工程与管理', studyMode: '全日制', startDate: '2025-09', endDate: '2027-06' },
    { school: '内蒙古科技大学', degree: '本科', major: '市场营销', startDate: '2019-09', endDate: '2023-06' }],
  internships: [{ company: '甲公司', title: '运营实习生', startDate: '2026-01', endDate: '', isCurrent: true, description: '做事' },
    { company: '乙公司', title: '采销实习生', startDate: '2025-11', endDate: '2026-01', description: '做事' }],
  workExperiences: [], projects: [{ name: '项目一', role: '负责人', startDate: '2025-09', endDate: '2026-01', description: '描述' }],
};
const facts = AF.profile.facts(profile);

test('飞书真实多选渠道保留选项内部标点，学习后能多项回填且不受顺序影响', () => {
  const F = AF.platforms.feishu, f = cases('feishu/multiselect.json').fields[0];
  assert.equal(F.kind(f), 'multi');
  const chosen = [f.options[1].value, f.options[2].value];
  const text = F.decode(f, chosen);
  assert.deepEqual(plain(F.encode(f, text).raw), chosen);
  assert.deepEqual(plain(F.encode(f, f.options[2].text).raw), [f.options[2].value]);
  assert.equal(F.same(f, chosen, [...chosen].reverse()), true);
  assert.equal(F.same(f, chosen, chosen.slice(0, 1)), false);
  assert.ok(F.encode(f, '字典中不存在的回答').error);
});

test('Moka：真实申请页 76 个字段里，内置字段全部按 id 对应', () => {
  const { fields } = cases('moka/zjshc-campus.json');
  const M = AF.platforms.moka;
  // 渲染所在块：自定义字段的 fieldInfo.blockId 写的是 basicInfo，但它们渲染在教育/项目块里（multi=true）。
  const f = (id, group = 'basicInfo', row = 0) => ({ ...fields.find(x => x.id === id), group, row });
  assert.deepEqual(plain(M.target(f('birthDate'))), { sem: 'birthDate' });
  assert.deepEqual(plain(M.target(f('ethnic'))), { sem: 'ethnicity' });
  assert.deepEqual(plain(M.target(f('nativePlace'))), { sem: 'hometown' });
  assert.deepEqual(plain(M.target(f('school', 'educationInfo', 1))), { list: 'edu', prop: 'school' });
  assert.deepEqual(plain(M.target(f('startDate', 'experienceInfo'))), { list: 'workOrIntern', prop: 'range' });
  assert.deepEqual(plain(M.target(f('title', 'projectInfo'))), { list: 'project', prop: 'role' });
  // 自定义字段靠问题文字
  assert.deepEqual(plain(M.target({ id: 175104, type: 'select_info', label: '学习形式', group: 'educationInfo', row: 0 })), { list: 'edu', prop: 'studyMode' });
  assert.deepEqual(plain(M.target({ id: 184462, type: 'select_info', label: '驾驶技能', group: 'basicInfo', row: 0 })), { sem: 'licenseType' });
  assert.deepEqual(plain(M.target({ id: 175103, type: 'select_info', label: '政治面貌（原）', group: 'basicInfo', row: 0 })), { sem: 'political' });
  // 没有任何对应的只能是自定义问题（交给 AI），内置字段不允许漏
  const missing = fields.filter(x => x.type !== 'file_upload' && x.type !== 'confirm_info' && !M.target({ ...x, group: x.blockId, label: x.name }));
  assert.ok(missing.every(x => typeof x.id === 'number' || ['recommendCode', 'campusSiteId', 'aimWorkCity', 'forwardLocation', 'department', 'responsibilities', 'personal'].includes(x.id)),
    '漏对应的内置字段：' + missing.filter(x => typeof x.id !== 'number').map(x => x.id).join(','));
});

test('Moka：值格式与真实页面一致', () => {
  const M = AF.platforms.moka;
  // 生日：本地当天 0 点的毫秒数（Moka 按浏览器时区显示）
  const birth = M.encode({ type: 'day_info' }, facts.birthDate).raw;
  const d = new Date(birth);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()], [2001, 5, 11, 0]);
  assert.equal(M.decode({ type: 'day_info' }, birth), '2001-05-11');
  // 籍贯：国标码，最深到区县；只到省的资料停在省
  assert.equal(M.encode({ type: 'location_info' }, facts.hometown).raw, '150402');
  assert.equal(M.encode({ type: 'location_info' }, '上海市/上海市/黄浦区').raw, '310101');
  assert.equal(M.encode({ type: 'location_info' }, facts.currentCity).raw, '310000');
  assert.equal(M.decode({ type: 'location_info' }, '150402'), '内蒙古/赤峰市/红山区');
  // 起止时间：年月；当前经历结束为“至今”
  assert.deepEqual(plain(M.encode({ type: 'date_info' }, AF.mapping.valueOf({ list: 'workOrIntern', prop: 'range' }, facts, 1)).raw), { start: '2025-11', end: '2026-01' });
  assert.deepEqual(plain(M.encode({ type: 'date_info' }, AF.mapping.valueOf({ list: 'workOrIntern', prop: 'range' }, facts, 0)).raw), { start: '2026-01', end: '至今' });
  // 下拉：内置 {label,value} 与自定义字符串两种选项
  assert.equal(M.encode({ type: 'select', options: [{ label: '汉族', value: '汉族' }, { label: '蒙古族', value: '蒙古族' }] }, '汉族').raw, '汉族');
  assert.equal(M.encode({ type: 'select', options: [{ label: '男', value: 'M' }, { label: '女', value: 'F' }] }, '男').raw, 'M');
  assert.deepEqual(plain(M.encode({ type: 'select_info', options: ['A照', 'B照', 'C照', '无'] }, 'C1')), { pick: ['A照', 'B照', 'C照', '无'] });
  assert.equal(M.encode({ type: 'bool_info' }, '否').raw, 0);
  assert.ok(M.same({ type: 'date_info' }, { start: '2025-9', end: '2026-01' }, { start: '2025-09', end: '2026-1' }));
});

test('北森：真实申请页 65 个字段的对应', () => {
  const { fields } = cases('beisen/mywind-campus.json');
  const B = AF.platforms.beisen;
  const by = n => fields.find(x => x.name === n);
  const t = n => plain(B.target({ ...by(n), id: n }));
  assert.deepEqual(t('RecruitmentPersonProfile_Birthday'), { sem: 'birthDate' });
  assert.deepEqual(t('RecruitmentPersonProfile_Nation'), { sem: 'ethnicity' });
  assert.deepEqual(t('RecruitmentPersonProfile_NativeArea'), { sem: 'hometown' });
  assert.deepEqual(t('RecruitmentApplicantEducation_SchoolName'), { list: 'edu', prop: 'school' });
  assert.deepEqual(t('RecruitmentApplicantInternship_StartDate'), { list: 'intern', prop: 'start' });
  assert.deepEqual(t('RecruitmentApplicantWorkExperience_CompanyName'), { list: 'work', prop: 'company' });
  // 北森“工作经历”和“实习经历”分开：没有正式工作就不能把实习填进工作经历
  assert.equal(AF.mapping.valueOf({ list: 'work', prop: 'company' }, facts, 0), undefined);
  const missing = fields.filter(x => !['BC_FileUploader'].includes(x.type) && !B.target({ ...x, id: x.name }));
  assert.ok(missing.every(x => /_ext|Recommend|InterviewSite|Skill|Writings|ExpectAnnualSalary|Speciality|Others|CertificateDescription/.test(x.name)),
    '漏对应：' + missing.map(x => x.name).join(','));
});

test('北森：值格式', () => {
  const B = AF.platforms.beisen;
  assert.deepEqual(plain(B.encode({ type: 'BC_DateTime', format: 'yyyy/MM/dd' }, '2001-05-11').raw), { text: '2001/05/11', value: '2001/05/11' });
  assert.deepEqual(plain(B.encode({ type: 'BC_RadioList', options: [{ text: '男', value: '0' }, { text: '女', value: '1' }] }, '男').raw), { text: '男', value: '0' });
  assert.deepEqual(plain(B.encode({ type: 'BC_PopConstant', options: [{ text: '汉族', value: '1' }] }, '汉族').raw), { text: '汉族', value: '1' });
  assert.deepEqual(plain(B.encode({ type: 'BC_DropDownList', options: [{ text: '是', value: 'y' }, { text: '否', value: 'n' }] }, '愿意').raw), { text: '是', value: 'y' });
  const tree = AF.region.beisen(fs.readFileSync(path.join(here, 'cases/beisen/areas-subset.txt'), 'utf8'));
  assert.deepEqual(plain(B.encode({ type: 'BC_PopArea' }, facts.hometown, { areaTree: tree }).raw), { text: '红山区', value: '150401' });
  assert.deepEqual(plain(B.encode({ type: 'BC_PopArea' }, '上海市/上海市/黄浦区', { areaTree: tree }).raw), { text: '黄浦区', value: '3101' });
});

test('地区：同名后缀、直辖市、只写下级', () => {
  const gb = AF.region.gb();
  assert.equal(AF.region.resolve(gb, '吉林省/吉林市').id, '220200');
  assert.equal(AF.region.resolve(gb, '吉林省').id, '220000');
  assert.equal(AF.region.resolve(gb, '浙江/杭州/西湖区').id, '330106');
  assert.equal(AF.region.resolve(gb, '红山区').id, '150402');   // 全国唯一
  assert.equal(AF.region.resolve(gb, '火星'), null);
});

test('选项叫法不一：语义匹配，且“全日制”绝不落到“非全日制”', () => {
  const opts = ['全国普通高等院校全日制', '统招专升本', '海外留学生', '全国普通高等院校非全日制', '非统招专升本', '成人高等教育'].map(t => ({ text: t, value: t }));
  const B = AF.platforms.beisen;
  for (const v of ['统招全日制', '全日制', '统招']) assert.equal(B.encode({ type: 'BC_DropDownList', options: opts }, v).raw?.value, '全国普通高等院校全日制', v);
  assert.equal(B.encode({ type: 'BC_DropDownList', options: opts }, '非全日制').raw?.value, '全国普通高等院校非全日制');
  assert.equal(AF.text.sim('否', '无') > 0.9, true);          // 同义词不被否定词保护误伤
  assert.equal(AF.text.sim('未婚', '已婚') < 0.5, true);
});

test('变通：年薪按月薪 ×12；输入框里的地区按问法给粒度', () => {
  assert.equal(AF.profile.facts({ jobPreferences: { expectedSalary: '15000' } }).expectedSalaryAnnual, '180000');
  assert.deepEqual(plain(AF.mapping.byLabel('期望年薪')), { sem: 'expectedSalaryAnnual' });
  assert.equal(AF.mapping.regionText('所在城市', '内蒙古自治区/赤峰市/红山区'), '赤峰市');
  assert.equal(AF.mapping.regionText('所在城市', '上海'), '上海市');
  assert.equal(AF.mapping.regionText('省份', '内蒙古自治区/赤峰市/红山区'), '内蒙古');
  assert.equal(AF.mapping.regionText('现居住地', '上海市/黄浦区'), '上海市黄浦区');
});

test('至今：有“至今”选项就选；没有就填今天（只到月份的填本月，日按 1 号）', () => {
  const M = AF.platforms.moka, B = AF.platforms.beisen, today = '2026-10-12';
  assert.deepEqual(plain(M.encode({ type: 'date_info', allowNow: true }, { start: '2026-08', end: '至今' }, { today }).raw), { start: '2026-08', end: '至今' });
  const edu = M.encode({ type: 'date_info', allowNow: false }, { start: '2025-09', end: '至今' }, { today });
  assert.deepEqual(plain(edu.raw), { start: '2025-09', end: '2026-10' });
  assert.ok(edu.note);
  assert.deepEqual(plain(B.encode({ type: 'BC_DateTime', format: 'yyyy/MM', hasNow: true }, '至今', { today }).raw), { now: true });
  assert.deepEqual(plain(B.encode({ type: 'BC_DateTime', format: 'yyyy/MM' }, '至今', { today }).raw), { text: '2026/10', value: '2026/10' });
  assert.deepEqual(plain(B.encode({ type: 'BC_DateTime', format: 'yyyy/MM/dd' }, '2025-04', { today }).raw), { text: '2025/04/01', value: '2025/04/01' });
  assert.ok(B.same({}, { value: '9999/12' }, { now: true }));
});

test('北森（极海）：个人信息里的最高学历一组、户口/现居住地、紧急联系人、家庭成员、声明题', () => {
  const { fields } = cases('beisen/geehy.json');
  const B = AF.platforms.beisen;
  const t = n => plain(B.target({ ...fields.find(x => x.name === n), id: n }));
  assert.deepEqual(t('RecruitmentPersonProfile_LastSchool'), { list: 'edu', prop: 'school', row: 0 });
  assert.deepEqual(t('RecruitmentPersonProfile_GraduationDate'), { list: 'edu', prop: 'end', row: 0 });
  assert.deepEqual(t('RecruitmentPersonProfile_AccountArea'), { sem: 'hukou' });
  assert.deepEqual(t('RecruitmentPersonProfile_LivingArea'), { sem: 'currentCity' });
  assert.deepEqual(t('RecruitmentPersonProfile_EmergencyPhone'), { sem: 'emergencyPhone' });
  assert.deepEqual(t('RecruitmentFamily_relation'), { list: 'family', prop: 'relation' });
  assert.deepEqual(t('RecruitmentApplicantWorkExperience_ReasonOfLeaving'), { list: 'work', prop: 'leaveReason' });
  assert.deepEqual(t('RecruitmentPersonProfile_extsfyqqzws_606911_637457049'), { sem: 'declareNo' });          // 是否有亲戚在我司
  assert.deepEqual(t('RecruitmentApplicantAdditionalInfo_extsfcfwybgs_606911_448052401'), { sem: 'declareNo' }); // 是否曾服务于本公司
  assert.equal(B.target({ id: 'X_extxmgxbm', label: '如有请列姓名、关系和部门' }), null);                     // 说明框不当声明题
  for (const q of ['是否有刑事犯罪记录', '是否认识本公司职员', '是否有重大疾病史']) assert.deepEqual(plain(AF.mapping.byLabel(q)), { sem: 'declareNo' }, q);
  assert.equal(facts.declareNo, '否');
  assert.equal(AF.mapping.valueOf({ list: 'intern', prop: 'leaveReason' }, facts, 1), '实习结束');
});

test('学习：换算规则跟着资料值走，资料改了不残留；字段改名照样认得；新的替换旧的', () => {
  const Mem = AF.memory;
  const f = { key: 'RecruitmentApplicantEducation_LearningForm|0', id: 'RecruitmentApplicantEducation_LearningForm', label: '学习形式', row: 0 };
  const m1 = Mem.make({ ...f, platform: 'beisen', from: '统招全日制', after: '全国普通高等院校全日制' }, 'a.zhiye.com');
  const store = { [m1.id]: m1 };
  assert.equal(Mem.lookup(store, 'beisen', f, '统招全日制'), '全国普通高等院校全日制');
  assert.equal(Mem.lookup(store, 'beisen', f, '非全日制'), null);                       // 资料改了：旧规则不生效
  assert.equal(Mem.lookup(store, 'beisen', { ...f, label: '培养方式' }, '统招全日制'), '全国普通高等院校全日制');   // 改名：按字段 id 认
  assert.equal(Mem.lookup(store, 'moka', f, '统招全日制'), null);                        // 别的平台不串
  // 同一字段再学一次：id 相同，存储时替换（旧值进历史由 background 处理）
  const m2 = Mem.make({ ...f, platform: 'beisen', from: '统招全日制', after: '统招' }, 'b.zhiye.com');
  assert.equal(m2.id, m1.id);
  // 自定义问题（各公司 id 不同）按问题文字；多条目按第几条分开
  const c0 = { key: 'x|0', id: 175105, label: '担任职务', row: 0 }, c1 = { ...c0, key: 'x|1', row: 1 };
  const a1 = Mem.make({ ...c1, platform: 'moka', from: null, after: '体育部部长' }, 'h');
  assert.equal(Mem.lookup({ [a1.id]: a1 }, 'moka', { ...c1, id: 999 }, null), '体育部部长');
  assert.equal(Mem.lookup({ [a1.id]: a1 }, 'moka', c0, null), null);
});

test('意向城市：按优先级挑网页上有的；省份算数；几个框依次填不同城市；都没有就空着', () => {
  const F = AF.profile.facts({ jobPreferences: { cities: ['上海', '深圳', '浙江'] } });
  assert.deepEqual(plain(F.cityPrefs), ['上海', '深圳', '浙江']);
  assert.deepEqual(plain(AF.mapping.byLabel('意向工作城市')), { sem: 'cityPref' });
  assert.deepEqual(plain(AF.platforms.moka.target({ id: 'aimWorkCity', group: 'applyInfo', label: '意向工作城市' })), { sem: 'cityPref' });
  assert.deepEqual(plain(AF.platforms.beisen.target({ id: 'RecruitmentApplicantObjective_ExpectWorkAreas', label: '期望工作城市' })), { sem: 'cityPref' });
  const P = ['上海', '深圳', '浙江'], pick = AF.mapping.pickCity;
  assert.equal(pick('select', ['北京市', '深圳市', '上海市'], P), '上海市');            // 最高优先级
  assert.equal(pick('select', ['北京市', '绍兴市', '深圳市'], P), '深圳市');            // 上海没有 → 深圳
  assert.equal(pick('select', ['北京市', '绍兴市'], P), '绍兴市');                     // 省份：浙江 → 绍兴
  assert.equal(pick('select', ['北京市', '广州市'], P), null);                         // 都没有 → 空着
  const used = new Set();
  const a1 = pick('select', ['上海市', '深圳市', '杭州市'], P, used); used.add(AF.region.core(a1));
  const a2 = pick('select', ['上海市', '深圳市', '杭州市'], P, used);
  assert.deepEqual([a1, a2], ['上海市', '深圳市']);                                     // 多个意向城市框依次填
  assert.equal(pick('region', [], P), '上海');                                         // 地区选择器
  assert.equal(pick('text', [], P), '上海');                                           // 输入框
});

test('公司自定的问题不让 AI 猜，只有开放题（多行文字）交给 AI', () => {
  assert.equal(AF.mapping.aiAllowed('select'), false);
  assert.equal(AF.mapping.aiAllowed('text'), false);
  assert.equal(AF.mapping.aiAllowed('textarea'), true);
  for (const q of ['面试站点', '从何途径得悉此职员招聘', '申请职位', '第一志愿', '推荐码']) assert.equal(AF.mapping.byLabel(q), null, q);
  assert.deepEqual(plain(AF.mapping.byLabel('期望薪酬（年）')), { sem: 'expectedSalaryAnnual' });
  assert.deepEqual(plain(AF.mapping.byLabel('期望薪酬（月）')), { sem: 'expectedSalary' });
  assert.deepEqual(plain(AF.mapping.byLabel('职位调剂')), { sem: 'acceptAdjustment' });
  assert.deepEqual(plain(AF.mapping.byLabel('是否退伍军人')), { sem: 'declareNo' });
});

test('学习：公司招聘来源问题只在同公司范围跨平台复用', () => {
  const f = { key: 'X_ext|0', id: 'RecruitmentApplicantAdditionalInfo_extCHTJ_613441_1', label: '从何途径得悉此职员招聘', row: 0, scope: 'job51:ctmid=company-a' };
  const m = AF.memory.make({ ...f, platform: 'beisen', from: null, after: '招聘网站' }, 'h');
  assert.equal(AF.memory.lookup({ [m.id]: m }, 'beisen', { ...f, id: 'RecruitmentApplicantAdditionalInfo_extCHTJ_999_2' }, null), '招聘网站');
  assert.equal(AF.memory.lookup({ [m.id]: m }, 'moka', { key: 'a|0|9', id: 12345, label: f.label, row: 0, scope: f.scope }, null), '招聘网站');
  assert.equal(AF.memory.lookup({ [m.id]: m }, 'moka', { key: 'a|0|9', id: 12345, label: f.label, row: 0, scope: 'job51:ctmid=company-b' }, null), null);
});

test('北森（景瑞）：每个字段要么对应资料，要么属于“公司自定 / 开放题”，没有内置字段漏掉', () => {
  const { fields } = cases('beisen/jingrui.json');
  const B = AF.platforms.beisen;
  const t = n => plain(B.target({ ...fields.find(x => x.name === n), id: n }));
  assert.deepEqual(t('RecruitmentPersonProfile_BirthArea'), { sem: 'sourceLocation' });
  assert.deepEqual(t('RecruitmentApplicantObjective_ExpectWorkAreas'), { sem: 'cityPref' });
  assert.deepEqual(t('RecruitmentApplicantEducation_Degree'), { list: 'edu', prop: 'degree' });
  const missing = fields.filter(x => x.type !== 'BC_FileUploader' && x.type !== 'BC_PictureUploader' && !B.target({ ...x, id: x.name }) && !/_ext/.test(x.name));
  // 到岗时间（AvailableDate）2026-10-13 起按“毕业后下个月 1 号”填，不再算漏
  assert.deepEqual(missing.map(x => x.name), ['RecruitmentAwards_AwardName', 'RecruitmentCertificate_Authority', 'RecruitmentCertificate_CertificateEffectiveDate']);
});

test('AI 认题结果存成规则：只记对应哪一项，值从资料取；“没有”也记住，下次不再问', () => {
  const f = { key: 'RecruitmentApplicantEducation_extbynf_1|0', id: 'RecruitmentApplicantEducation_extbynf_1', label: '毕业年月', row: 0, section: '教育经历' };
  const r1 = AF.memory.makeMap(f, 'beisen', 'edu.end', 'AI', 'h');
  const interview = { ...f, id: 'X_ext_2', label: '面试站点', scope: 'beisen:company-a' };
  const r2 = AF.memory.makeMap(interview, 'beisen', null, 'AI', 'h');
  const store = { [r1.id]: r1, [r2.id]: r2 };
  assert.deepEqual(plain(AF.memory.lookupMap(store, 'beisen', f)), { list: 'edu', prop: 'end' });
  assert.equal(AF.memory.lookupMap(store, 'beisen', interview), null);       // 记过“没有”
  assert.equal(AF.memory.lookupMap(store, 'beisen', { ...interview, scope: 'beisen:company-b' }), undefined);
  assert.equal(AF.memory.lookupMap(store, 'beisen', { ...f, id: 'Y', label: '没见过的题' }), undefined);        // 没记过 → 去问 AI
  assert.equal(AF.mapping.valueOf(AF.memory.lookupMap(store, 'beisen', f), facts, 0), '2027-06');              // 值来自资料
  assert.equal(AF.memory.lookup(store, 'beisen', interview, null), null);    // 对应规则不当成固定回答
});

test('乱学压力测试：随机学习、改主意、改资料、跨段落、跨平台 2000 轮，记忆永远不互搏', () => {
  // 简化的存储：和 background MEM_SAVE 同样的规则（同 id 只留最新，旧值进历史）
  const save = (store, m) => { const old = store[m.id]; store[m.id] = { ...m, history: old && old.to !== m.to ? [{ to: old.to }, ...(old.history || [])].slice(0, 5) : old?.history || [] }; };
  let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const fields = [
    { key: 'a|0', id: 'RecruitmentApplicantEducation_EducationLevel', label: '学历', section: '教育经历', row: 0 },
    { key: 'b|0', id: 'X_ext_1', label: '职务', section: '项目经历', row: 0 },
    { key: 'c|0', id: 'X_ext_2', label: '职务', section: '在校经历', row: 0 },
    { key: 'd|0', id: 777, label: '到岗时间', section: '求职意向', row: 0 },
  ];
  const platforms = ['beisen', 'moka'], profileVals = ['硕士', '博士', '本科'], answers = ['A', 'B', 'C', 'D'];
  const store = {}, truth = new Map();   // truth：我们期望的“最新一次学到的值”
  for (let i = 0; i < 2000; i++) {
    const f = fields[rnd(fields.length)], pf = platforms[rnd(2)];
    const mapped = f.label === '学历', from = mapped ? profileVals[rnd(3)] : null, to = answers[rnd(4)];
    const m = AF.memory.make({ ...f, platform: pf, from, after: to }, 'h');
    save(store, m);
    truth.set([pf, f.key, from].join('~'), to);
    // 每一轮都核对所有已学内容
    for (const [k, want] of truth) {
      const [p, key, fr] = k.split('~'); const g = fields.find(x => x.key === key);
      const got = AF.memory.lookup(store, p, g, fr === '' ? null : fr);
      if (got !== want) assert.fail(`第 ${i} 轮：${k} 应为 ${want}，实际 ${got}`);
    }
  }
  // 资料改成没学过的值：不残留
  assert.equal(AF.memory.lookup(store, 'beisen', fields[0], '大专'), null);
  // 项目经历的“职务”和在校经历的“职务”分开
  const p1 = AF.memory.lookup(store, 'beisen', fields[1], null), p2 = AF.memory.lookup(store, 'beisen', fields[2], null);
  assert.equal(p1, truth.get('beisen~b|0~') ?? null); assert.equal(p2, truth.get('beisen~c|0~') ?? null);
  // 每个身份只留一条，历史最多 5 条
  assert.ok(Object.values(store).every(m => (m.history || []).length <= 5));
  assert.ok(Object.keys(store).length <= fields.length * platforms.length * 3);
});

test('Hotjob：真实简历页的字段对应、值格式（字典编码、市级地区、学校专业按网站字典挑）', async () => {
  const { fields, areaSample, subjectSearch } = cases('hotjob/wecruit-resume.json');
  const H = AF.platforms.hotjob;
  const f = k => ({ options: [], ...fields.find(x => x.key === k) });
  const t = k => plain(H.target(f(k)));
  assert.deepEqual(t('11_22'), { sem: 'nationality' });
  assert.deepEqual(t('11_245'), { sem: 'hometown' });
  assert.deepEqual(t('13_44'), { sem: 'cityPref' });
  assert.deepEqual(t('14_54_1'), { list: 'edu', prop: 'major' });
  assert.deepEqual(t('14_130056_1'), { list: 'edu', prop: 'fullTime' });
  assert.deepEqual(t('123_2130_1'), { list: 'intern', prop: 'company' });
  assert.deepEqual(t('16_63_1'), { sem: 'englishLevel' });
  assert.equal(t('13_45'), null);   // 期望职能：资料里没有，留给用户
  // 下拉存字典编码；“六级”对“大学英语六级考试”
  assert.equal(H.encode(f('11_20'), '男').raw, '0/599/604');
  assert.equal(H.encode(f('16_63_1'), facts.englishLevel || '六级').raw, '0/454/551');
  assert.equal(H.encode(f('14_130056_1'), facts.lists.edu[0].fullTime).raw, '0/4500/4501');
  // 日期：年月补 1 号；有“至今”存 1000-01-01；没有就填今天
  assert.equal(H.encode(f('14_49_1'), '2025-09').raw, '2025-09-01');
  assert.equal(H.encode(f('14_50_1'), '至今').raw, '1000-01-01');
  assert.equal(H.encode(f('123_2125_1'), '至今', { today: '2026-10-13' }).raw, '2026-10-13');
  // 地区：写到市（直辖市往下走到“上海市”，区县往上收到市）
  ctx.AF.rpc = async () => areaSample;
  await H.prepare([f('11_26')]);
  assert.equal(H.encode(f('11_26'), '上海').raw, '0/4/10/11');
  assert.equal(H.encode(f('11_245'), '内蒙古自治区/赤峰市/红山区').raw, '0/4/57/75');
  // 专业：网站名字带门类括号，去掉括号比；记住的全名也认
  const major = { ...f('14_54_1'), dictOptions: subjectSearch };
  assert.deepEqual(plain(H.encode(major, '物流工程与管理').raw), { code: '0/660/-15397/-15952', name: '物流工程与管理(管理学类专业学位)' });
  assert.ok(H.encode(major, '交通运输').pick, '搜不到同名的交给 AI 在网站候选里挑');
});

test('派生事实：最高/第一学历、是否毕业、是否全日制、到岗时间、培养方式', () => {
  const e = facts.lists.edu;
  assert.deepEqual([e[0].isHighest, e[1].isHighest, e[0].isFirst, e[1].isFirst], ['是', '否', '否', '是']);
  assert.equal(e[1].graduated, '是');
  assert.equal(facts.availableDate, '2027-07-01');
  assert.deepEqual(plain(AF.mapping.byLabel('最快可到岗时间')), { sem: 'availableDate' });
  assert.deepEqual(plain(AF.mapping.byLabel('学习形式')), { list: 'edu', prop: 'studyMode', row: 0 });
  assert.deepEqual(plain(AF.mapping.byLabel('是否最高学历', 'edu')), { list: 'edu', prop: 'isHighest' });
  assert.deepEqual(plain(AF.mapping.byLabel('是否有家族遗传病史，心脏、血液、肝脏等疾病，以及其他慢性、传染性疾病？')), { sem: 'declareNo' });
  // 培养方式：统招全日制 = 非定向（统招、并轨），绝不选“定向”
  const opts = ['非定向（统招、并轨）', '定向'];
  assert.equal(AF.text.best('统招全日制', opts).item, '非定向（统招、并轨）');
  assert.ok(AF.text.best('统招全日制', opts).score >= 0.8);
  assert.ok(AF.text.sim('全日制', '定向') < 0.5);
});

test('飞书招聘：字段路径对应、值格式（下拉 value、起止时间、至今、城市编码、手机号）', async () => {
  const { fields, citySample } = cases('feishu/duodian-apply.json');
  const Fs = AF.platforms.feishu;
  const f = k => ({ options: [], ...fields.find(x => x.key === k) });
  assert.deepEqual(plain(Fs.target(f('age'))), { sem: 'age' });
  assert.deepEqual(plain(Fs.target(f('education[0].fieldOfStudy'))), { list: 'edu', prop: 'major' });
  assert.deepEqual(plain(Fs.target(f('education[0].education_type'))), { list: 'edu', prop: 'studyMode' });
  assert.deepEqual(plain(Fs.target(f('internship[0].period'))), { list: 'intern', prop: 'range' });
  assert.equal(Fs.target(f('6932773077378484488[0].7694293915604437284')), null);   // 公司自建题：留给用户 / 记忆
  assert.equal(Fs.listOfGroup('work'), null);   // “作品”，不是工作经历
  assert.equal(Fs.encode(f('gender'), '男').raw, 1);
  assert.equal(Fs.encode(f('education[0].degree'), '硕士').raw, 7);
  assert.equal(Fs.encode(f('education[0].education_type'), '统招全日制').raw, 2);
  assert.deepEqual(plain(Fs.encode(f('mobile'), '+86 131-2001-0419').raw), { tel: '13120010419', code: 'CN_1' });
  assert.deepEqual(plain(Fs.encode(f('internship[0].period'), { start: '2026-08', end: '至今' }).raw), { start: '2026-08', end: '至今' });
  // 教育经历没有“至今”：填本月
  assert.deepEqual(plain(Fs.encode(f('education[0].period'), { start: '2025-09', end: '至今' }, { today: '2026-10-13' }).raw), { start: '2025-09', end: '2026-10' });
  ctx.AF.rpc = async () => citySample;
  await Fs.prepare([f('preferredCityCodeList')]);
  assert.deepEqual(plain(Fs.encode(f('preferredCityCodeList'), '上海').raw), ['CT_125']);
  assert.deepEqual(plain(Fs.encode(f('preferredCityCodeList'), '杭州').raw), ['CT_200']);
  assert.ok(Fs.encode(f('preferredCityCodeList'), '浙江').error, '只写了省、省下有多个市：不乱选');
  assert.equal(facts.age, String(new Date().getFullYear() - 2001 - (new Date() < new Date(new Date().getFullYear(), 4, 11) ? 1 : 0)));
});

test('排名档位：选最紧但成立的一档，不往好里报', () => {
  assert.equal(AF.text.best('前10%', ['前5%', '前20%', '前50%', '其他']).item, '前20%');
  assert.equal(AF.text.best('前5%', ['前5%', '前20%']).item, '前5%');
  assert.equal(AF.text.best('前60%', ['前5%', '前20%', '前50%']).item !== '前50%', true);
});

test('51job 经典录入页：几个下拉拼成的字段按控件给候选（省+市、年+月、等级+分数段）', () => {
  const { classic } = cases('job51/classic-and-cards.json');
  const J = AF.platforms.job51;
  const f = k => classic.find(x => x.key === k);
  assert.equal(J.kind(f('Birthday|0|0')), 'ym');
  assert.equal(J.kind(f('City|1|0')), 'region');
  assert.equal(J.kind(f('EnglishLevel|5|0')), 'select2');
  assert.deepEqual(plain(J.encode(f('Birthday|0|0'), '2001-05-11').raw), [['2001'], ['05', '5']]);
  assert.deepEqual(plain(J.encode(f('City|1|0'), '上海').raw), [['上海'], ['上海市', '上海']]);
  assert.deepEqual(plain(J.encode(f('City|1|0'), '内蒙古自治区/赤峰市/红山区').raw)[0], ['内蒙古']);
  assert.deepEqual(plain(J.encode(f('MobilePhone|1|0'), '13120010419').raw), [null, '13120010419']);
  assert.deepEqual(plain(J.encode(f('EnglishLevel|5|0'), '六级', { facts: { englishScore: '525' } }).raw), [['大学英语6级(CET6)'], [{ num: 525 }]]);
  assert.ok(J.same(f('Birthday|0|0'), ['2001', '05'], [['2001'], ['05', '5']]));
  assert.ok(!J.same(f('Birthday|0|0'), ['2001', '04'], [['2001'], ['05', '5']]));
});

test('51job 新版卡片：colName 对应、字典编码、两级地区存市、教育拆卡对应第几条', async () => {
  const { cards, areaSample } = cases('job51/classic-and-cards.json');
  const V = AF.platforms.job51v;
  const f = k => cards.find(x => x.key === k);
  assert.deepEqual(plain(V.target(f('cc1|0|party'))), { sem: 'political' });
  assert.equal(V.encode(f('cc1|0|party'), '群众').raw, '3');
  assert.equal(V.encode(f('cc1|0|birthday'), '2001-05-11').raw, '2001-05-11 00:00:00');
  assert.equal(V.encode(f('sub10|0|cca7'), '前10%').raw, '2');
  assert.equal(V.encode(f('sub10|0|cca2'), '上海理工大学').raw, '1234');
  assert.deepEqual(plain(V.target(f('sub10|0|cca2'))), { list: 'edu', prop: 'school', row: 0 });
  assert.deepEqual(plain(V.target(f('sub12|0|cca2'))), { list: 'edu', prop: 'school', row: 2 });
  ctx.AF.rpc = async () => areaSample;
  await V.prepare([f('cc1|0|cce1')]);
  assert.equal(V.encode(f('cc1|0|cce1'), '内蒙古自治区/赤峰市/红山区').raw, '280300');
  assert.equal(V.encode(f('cc1|0|cce1'), '上海').raw, '020000');
});

test('2026-10-15 日志：手填过的题自动答、资料补充、跨段落记忆、其他语种不拿英语顶', () => {
  const by = (l, list) => plain(AF.mapping.byLabel(l, list));
  assert.deepEqual(by('毕业届别（按最高学历毕业年份填写）'), { sem: 'classOf' });
  assert.equal(facts.classOf, '2027届');
  assert.deepEqual(by('最近毕业专业学科门类'), { sem: 'discipline' });
  assert.equal(facts.discipline, '管理学');
  assert.deepEqual(by('工作性质', 'workOrIntern'), { list: 'workOrIntern', prop: 'nature' });
  assert.equal(facts.lists.intern[0].nature, '实习');
  assert.deepEqual(by('国家/地区', 'edu'), { list: 'edu', prop: 'country' });
  assert.equal(AF.text.best('中国', ['中国大陆', '中国香港', '海外']).item, '中国大陆');
  assert.deepEqual(by('可以到岗时间（全职）'), { sem: 'availableDate' });
  assert.deepEqual(by('英语等级分数'), { sem: 'englishScore' });
  assert.deepEqual(by('GPA成绩（例：3.75/4）'), { list: 'edu', prop: 'gpa', row: 0 });
  assert.deepEqual(by('日语水平'), { sem: 'none' });
  assert.deepEqual(plain(AF.mapping.bySection('得分', '语言能力')), { sem: 'englishScore' });
  // 专业类别对不上就退到学科门类
  assert.deepEqual(plain(AF.mapping.alternatives({ list: 'edu', prop: 'majorCategory' }, AF.profile.facts({ ...profile, educations: [{ ...profile.educations[0], majorCategory: '工商管理类' }] }), 0)), ['管理学']);
  // 资料补充：资料空着的 GPA 补进来，资料有值时不覆盖
  const f2 = AF.profile.facts(profile, { 'edu.0.gpa': '3.7', 'sem.name': '别人' });
  assert.equal(f2.lists.edu[0].gpa, '3.7');
  assert.equal(f2.name, profile.personal.fullName);
  // 跨网站、跨段落名：同一句话答过且一致才用；答过两种说法不猜；经历块里不用
  const m1 = AF.memory.make({ platform: 'moka', id: 1, label: '宗教信仰', section: '个人信息', after: '无' }, 'a');
  const mem = { [m1.id]: m1 };
  assert.equal(AF.memory.lookup(mem, 'beisen', { id: 'X_ext_1', label: '宗教信仰', section: '基本信息', row: 0 }, null), '无');
  const m2 = AF.memory.make({ platform: 'hotjob', id: 2, label: '宗教信仰', section: '其他', after: '佛教' }, 'b');
  assert.equal(AF.memory.lookup({ ...mem, [m2.id]: m2 }, 'beisen', { id: 'X_ext_1', label: '宗教信仰', section: '基本信息', row: 0 }, null), null);
  assert.equal(AF.memory.lookup(mem, 'beisen', { id: 'X_ext_1', label: '宗教信仰', section: '教育经历', row: 0 }, null), null);
});
