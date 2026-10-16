// 北森（*.zhiye.com）：字段名是“对象_字段”（RecruitmentPersonProfile_Birthday），来自 2026-10-12 真实申请页（test/cases/beisen/）。
// 所有字段的写入约定都是 onChange({text, value})；选项在 cmp_data.datasource，日期格式在 data_format。
(() => {
  const AF = (globalThis.AF ||= {});
  (AF.platforms ||= {});
  if (AF.platforms.beisen) return;
  const { best, norm } = AF.text;
  const D = () => AF.convert;

  // 对象 → 资料列表（null = 单值）
  const OBJECT = {
    RecruitmentPersonProfile: null, RecruitmentApplicantObjective: null, RecruitmentApplicantAdditionalInfo: null,
    RecruitmentApplicantEducation: 'edu', RecruitmentApplicantInternship: 'intern', RecruitmentApplicantWorkExperience: 'work',
    RecruitmentApplicantProject: 'project', RecruitmentSchoolPractice: 'campus', RecruitmentSchoolCadre: 'campus',
    RecruitmentCertificate: 'cert', RecruitmentFamily: 'family', RecruitmentWritings: 'publication', RecruitmentLang: null, RecruitmentSkill: null, RecruitmentAttachments: null,
  };
  const SINGLE = { Name: 'name', Mobile: 'phone', Email: 'email', Gender: 'gender', Birthday: 'birthDate', Nation: 'ethnicity',
    NativeArea: 'hometown', Polity: 'political', IsFreshGraduated: 'graduateType', Interest: 'interests',
    // 2026-10-12 极海微电子实测补充
    CertificateNumber: 'idNumber', IDNumber: 'idNumber', Height: 'height', Weight: 'weight', WedState: 'marital',
    EmergencyContact: 'emergencyName', EmergencyPhone: 'emergencyPhone', AccountArea: 'hukou', LivingArea: 'currentCity',
    ExpectSalary: 'expectedSalary', LanguageType: 'languageType', ExpectWorkAreas: 'cityPref', YearsOfWork: 'yearsOfWork' };
  // 个人信息里的“最高学历”一组：对应资料第一条教育经历
  const PERSON_EDU = { LastSchool: 'school', EducationLevel: 'degree', HighestDegree: 'degree', LastDiscipline: 'major', GraduationDate: 'end' };
  const LIST = {
    edu: { SchoolName: 'school', CollegeName: 'faculty', MajorName: 'major', EducationLevel: 'degree', StartDate: 'start', EndDate: 'end',
      LearningForm: 'studyMode', TrainingMode: 'studyMode', GPA: 'gpa', MajorRank: 'ranking', MajorCourses: 'courses' },
    // 实习/工作地点：资料里没有，明确对到“地点”（空着），不再交给 AI（AI 曾把它认成单位名称，2026-10-13 中交、英诺赛科）
    intern: { CompanyName: 'company', JobTitle: 'title', StartDate: 'start', EndDate: 'end', Duty: 'desc', PlaceArea: 'location', JobArea: 'location', ReasonOfLeaving: 'leaveReason' },
    work: { CompanyName: 'company', JobTitle: 'title', StartDate: 'start', EndDate: 'end', JobDuty: 'desc', ReasonOfLeaving: 'leaveReason', JobArea: 'location', PlaceArea: 'location' },
    family: { relation: 'relation', Name: 'name', telephone: 'phone', CompanyName: 'company', JobTitle: 'title' },
    project: { ProjectName: 'name', Position: 'role', StartDate: 'start', EndDate: 'end', ProjectInfo: 'desc' },
    campus: { PracticeName: 'org', PracticeStartDateTime: 'start', PracticeEndDateTime: 'end', PracticeDescription: 'desc',
      CadreName: 'role', CadreStartDateTime: 'start', CadreEndDateTime: 'end', CadreDescription: 'desc' },
    cert: { CertificateName: 'name', ObtainDate: 'date' },
    publication: { WritingsTitle: 'name', WritingsPublishDate: 'date' },
  };

  // Some Beisen tenants reuse RecruitmentSchoolPractice for research/project
  // entries. The page adapter marks the entire block only when its real
  // PracticeName label explicitly identifies a research/project entry.
  const listOf = f => {
    const [obj] = split(f);
    if (obj === 'RecruitmentSchoolPractice' && f.listKind === 'project') return 'project';
    return OBJECT[obj] || null;
  };
  const KIND = { BC_TextBox: 'text', BC_Email: 'text', BC_TextArea: 'textarea', BC_RadioList: 'select', BC_DropDownList: 'select',
    BC_PopConstant: 'select', BC_CheckBoxList: 'multi', BC_DateTime: 'date', BC_PopArea: 'region', BC_FileUploader: 'file',
    BC_PictureUploader: 'file', BC_DigitText: 'text' };

  const split = f => { const i = f.id.indexOf('_'); return [f.id.slice(0, i), f.id.slice(i + 1)]; };
  const kind = f => {
    const k = KIND[f.type] || 'unknown';
    // 学校名称这类 PopConstant 没有固定选项（远程搜索），按文字写，由回读判断网站收没收。
    return k === 'select' && !(f.options || []).length ? 'text' : k;
  };
  function target(f) {
    const [obj, field] = split(f);
    const list = listOf(f);
    if (list && LIST[list]?.[field]) return { list, prop: LIST[list][field] };
    if (obj === 'RecruitmentSchoolPractice' && list === 'project') {
      if (field === 'PracticeName') return { list: 'project', prop: 'name' };
      if (field === 'PracticeDescription') return { list: 'project', prop: 'desc' };
      if (field === 'PracticeStartDateTime') return { list: 'project', prop: 'start' };
      if (field === 'PracticeEndDateTime') return { list: 'project', prop: 'end' };
      if (f.label === '担任角色') return { list: 'project', prop: 'role' };
    }
    if (obj === 'RecruitmentPersonProfile' && PERSON_EDU[field]) return { list: 'edu', prop: PERSON_EDU[field], row: 0 };
    if (list === 'edu' && f.label === '专业人数') return { list: 'edu', prop: 'majorSize' };
    if (OBJECT[obj] === null && SINGLE[field]) return { sem: SINGLE[field] };
    return AF.mapping.byLabel(f.label, list || null);
  }
  const options = f => (f.options || []).map(o => ({ text: String(o.text), value: o.value }));

  // ctx.areaTree：北森地区树（引擎按 f.areaUrl 取来后传入）
  function encode(f, v, ctx = {}) {
    const k = kind(f), t = String(v);
    const fieldTarget = f.id ? target(f) : null;
    if (fieldTarget?.list === 'edu' && fieldTarget?.prop === 'majorSize') {
      if (!/^\d+$/.test(t) || !Number.isSafeInteger(Number(t)) || Number(t) < 1) return { error: `专业人数必须是正整数，收到“${t}”` };
      return { raw: { text: t, value: t } };
    }
    if (k === 'text' || k === 'textarea') return { raw: { text: t, value: t } };
    if (k === 'select') {
      const opts = options(f);
      let hit = best(t, opts, o => o.text);
      // 是非题选项常是“是/否”，资料写“愿意/接受”
      if (hit.score < 0.8 && D().yesNo(t) != null) { const want = D().yesNo(t) ? /^(是|有|愿意|接受|服从)/ : /^(否|无|不)/; const o = opts.find(x => want.test(x.text)); if (o) hit = { item: o, score: 0.9 }; }
      return hit.score >= 0.8 ? { raw: { text: hit.item.text, value: hit.item.value } } : { pick: opts.map(o => o.text) };
    }
    if (k === 'date') {
      const d = D().parseDate(v);
      if (!d && D().NOW.test(t)) {
        // 至今：网页有“至今”勾选框就勾它；没有就填今天（网页要一个明确的结束时间点）
        if (f.hasNow) return { raw: { now: true } };
        const today = D().parseDate(ctx.today || new Date().toISOString().slice(0, 10));
        const s = D().format(today, f.format || 'yyyy/MM/dd');
        return { raw: { text: s, value: s }, note: '网页没有“至今”，已填今天' };
      }
      if (!d) return { error: `无法识别日期“${v}”` };
      const s = D().format(d, f.format || 'yyyy/MM/dd');
      return { raw: { text: s, value: s } };
    }
    if (k === 'region') {
      if (!ctx.areaTree) return { error: '没取到北森地区表' };
      const hit = AF.region.resolve(ctx.areaTree, v);
      return hit ? { raw: { text: hit.name, value: hit.id } } : { error: `地区表里找不到“${v}”` };
    }
    return { error: '这类控件不自动填写' };
  }
  const decode = (f, raw) => (raw && typeof raw === 'object' ? String(raw.text ?? raw.value ?? '') : String(raw ?? ''));
  const same = (f, a, b) => {
    if (b && b.now) return /^9999/.test(String(a?.value ?? ''));
    if (kind(f) === 'date') {
      if (!D().sameYM(a?.value, b?.value)) return false;
      const ad = D().parseDate(a?.value)?.d || null, bd = D().parseDate(b?.value)?.d || null;
      return ad === bd || ((!ad || !bd) && (!ad || ad === '01') && (!bd || bd === '01'));
    }
    return String(a?.value ?? '') === String(b?.value ?? '') || norm(decode(f, a)) === norm(decode(f, b));
  };

  const SECTION = { RecruitmentPersonProfile: '个人信息', RecruitmentApplicantObjective: '求职意向', RecruitmentApplicantEducation: '教育经历',
    RecruitmentApplicantWorkExperience: '工作经历', RecruitmentApplicantProject: '项目经历', RecruitmentApplicantInternship: '实习经历',
    RecruitmentSchoolPractice: '在校实践', RecruitmentSchoolCadre: '在校职务', RecruitmentSkill: '技能', RecruitmentWritings: '论文/专著',
    RecruitmentCertificate: '证书', RecruitmentApplicantAdditionalInfo: '附加信息', DeliveryIntentionCustom: '投递意向', RecommendCodeCustom: '投递意向',
    RecruitmentFamily: '家庭成员', RecruitmentAwards: '获奖情况', RecruitmentLang: '语言能力', RecruitmentAttachments: '附件', RecruitmentResumeFile: '简历附件' };
  const section = f => SECTION[split(f)[0]] || '';

  // 补条目时传给页面侧的参数：北森按“添加教育经历”这种按钮文字找
  const addArg = f => section(f);

  AF.platforms.beisen = { name: '北森', kind, target, options, encode, decode, same, section, addArg, listOf };
})();
