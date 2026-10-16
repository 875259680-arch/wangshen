// 资料 → 语义事实：所有平台都对应到这一份键，不直接读资料原始结构。
// 新平台只需要写“平台字段 → 语义键”的表（mapping.js），不用再碰资料格式。
(() => {
  if (globalThis.AF?.profile) return;
  const AF = (globalThis.AF ||= {});

  const s = v => (v == null ? '' : String(v).trim());
  const NOW = /^(至今|现在|目前|在职|在读|present|now)$/i;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // 单值事实。键名就是对外的“语义键”，mapping 和 AI 都用它。
  function single(p) {
    const P = p.personal || {}, C = p.contactAndLocation || {}, I = p.identityAndAuthorization || {};
    const J = p.jobPreferences || {}, S = p.skills || {}, L = p.languageFacts || {}, A = p.additional || {};
    return {
      name: s(P.fullName), gender: s(P.gender), birthDate: s(P.birthDate),
      phone: s(P.phoneNumber), phoneCountry: s(P.phoneCountryCode), email: s(P.email),
      nationality: s(P.nationality) || '中国', ethnicity: s(P.ethnicity), political: s(P.politicalStatus),
      marital: s(P.maritalStatus), height: s(P.height), weight: s(P.weight), health: s(P.healthStatus),
      graduateType: s(P.graduateType), jobSearchStatus: s(P.jobSearchStatus),
      idType: s(I.personalIdType), idNumber: s(I.personalIdNumber),
      license: s(I.driversLicense), licenseType: s(I.driversLicenseType),
      hometown: s(C.hometownCity), hukou: s(C.hukouLocation), currentCity: s(C.currentCity),
      sourceLocation: s(C.sourceLocation), address: s(C.currentAddressLine1) || s(C.mailingAddress), mailing: s(C.mailingAddress),
      emergencyName: s(C.emergencyContactName), emergencyPhone: s(C.emergencyContactPhone),
      expectedSalary: s(J.expectedSalary), acceptAdjustment: s(J.acceptAdjustment),
      // 资料里的期望薪资按月填；问“年薪”时乘 12（填的数已经像年薪的就原样用）。以前 AI 会把月薪直接填进年薪。
      expectedSalaryAnnual: (n => (n && n < 100000 ? String(n * 12) : s(J.expectedSalary)))(+String(J.expectedSalary || '').replace(/[^\d.]/g, '')),
      skills: s(S.primarySkills), interests: s(S.interests),
      // “525.00” → “525”（网页问分数时没人写小数）
      languageType: s(L.type), englishLevel: s(L.level), englishScore: s(L.score).replace(/\.0+$/, ''),
      awards: s(A.awards),
      // 声明类问题（犯罪记录、疾病、亲属在本公司……）的默认回答。真有情况在面板里改一次并“记住”即可。
      declareNo: '否',
      // 工作年限：应届/在读的统一答“应届毕业生”（选项里没有时由同义词和 AI 挑“无/在读学生”等）
      yearsOfWork: /应届|在读|学生/.test(s(P.graduateType) + s(P.jobSearchStatus)) || !s(P.yearsOfExperience) ? '应届毕业生' : s(P.yearsOfExperience),
      // 意向城市优先级：资料 jobPreferences.cities（数组或“上海、深圳”），没写时用现居城市
      cityPrefs: (Array.isArray(J.cities) ? J.cities : String(J.cities || '').split(/[、,，\s/]+/)).map(s).filter(Boolean),
    };
  }

  // 经历类：统一成 start/end/current，平台只管“这一条的第几个属性”。
  const range = x => {
    const end = s(x.endDate);
    const current = x.isCurrent === true || NOW.test(end);
    return { start: s(x.startDate), end: current && (!end || NOW.test(end)) ? '至今' : end, current };
  };
  function lists(p) {
    const arr = k => (Array.isArray(p[k]) ? p[k] : []);
    return {
      // 是否最高学历 / 第一学历 / 是否毕业 / 是否全日制：由条目顺序（按时间由近到远）和学习形式推出来，不用每家公司各记一遍
      edu: arr('educations').map((x, i, all) => ({ ...range(x), school: s(x.school), major: s(x.major), degree: s(x.degree), studyMode: s(x.studyMode),
        faculty: s(x.faculty), gpa: s(x.gpa), ranking: s(x.ranking), courses: s(x.courses), majorSize: s(x.majorSize), majorCategory: s(x.majorCategory), schoolType: s(x.schoolType),
        isHighest: i === 0 ? '是' : '否', isFirst: i === all.length - 1 ? '是' : '否',
        graduated: range(x).current || /在读/.test(s(x.graduationStatus)) || (s(x.endDate) && s(x.endDate).slice(0, 7) > today().slice(0, 7)) ? '否' : '是',
        fullTime: /非全日制|在职/.test(s(x.studyMode)) ? '否' : /全日制|统招/.test(s(x.studyMode)) ? '是' : '',
        country: s(x.country) || '中国', discipline: disciplineOf(s(x.majorCategory), s(x.major)) })),
      // 离职原因：实习按“实习结束”；还在实习的写“实习进行中”（极海等把离职原因设成必填，2026-10-15）
      intern: arr('internships').map(x => ({ ...range(x), ...workDetails(x), company: s(x.company), title: s(x.title), desc: s(x.description), leaveReason: range(x).current ? '实习进行中' : '实习结束', country: '中国', nature: '实习' })),
      work: arr('workExperiences').map(x => ({ ...range(x), ...workDetails(x), company: s(x.company), title: s(x.title), desc: s(x.description), leaveReason: s(x.leaveReason), country: '中国', nature: '全职' })),
      project: arr('projects').map(x => ({ ...range(x), name: s(x.name), role: s(x.role), desc: s(x.description) })),
      campus: arr('campusExperiences').map(x => ({ ...range(x), org: s(x.organization), role: s(x.role), desc: s(x.description), category: s(x.category), roleCategory: s(x.roleCategory) })),
      publication: arr('publications').map(x => ({ name: s(x.name || x.title), date: s(x.publishDate), category: s(x.category), journal: s(x.journal) })),
      cert: arr('certificates').map(x => ({ name: s(x.name), date: s(x.issueDate), score: s(x.score), category: s(x.category) })),
      family: arr('familyMembers').map(x => ({ name: s(x.name), relation: s(x.relationship), company: s(x.company), title: s(x.title), phone: s(x.phone) })),
    };
  }
  function workDetails(x) {
    const a = s(x.startDate).match(/^(\d{4})[-/.](\d{1,2})/), b = range(x).end.replace(/^至今$/, today()).match(/^(\d{4})[-/.](\d{1,2})/);
    const months = a && b ? (+b[1] - +a[1]) * 12 + (+b[2] - +a[2]) : null;
    return { industry: s(x.industry), companySize: s(x.companySize), jobCategory: s(x.jobCategory), workplaceType: s(x.workplaceType), department: s(x.department),
      duration: months != null && months >= 0 ? String(Math.max(1, months)) + '个月' : '' };
  }

  // 专业类 → 学科门类（教育部本科专业目录的上一级）。只列常见的，没有的返回空，交给选项匹配 / AI。
  const DISCIPLINE = [
    [/管理科学与工程|工商管理|公共管理|物流管理|物流工程与管理|工程管理|电子商务|旅游管理|农业经济管理|图书情报|工业工程|会计|财务管理|市场营销|人力资源|审计/, '管理学'],
    [/经济|金融|财政|贸易|保险|税收/, '经济学'], [/法学|政治|社会学|民族学|马克思|公安/, '法学'], [/教育|体育/, '教育学'],
    [/中国语言|外国语言|新闻|传播|汉语|英语/, '文学'], [/历史|考古/, '历史学'], [/数学|物理|化学|生物科学|统计|地理|心理|天文|大气|海洋|地质/, '理学'],
    [/计算机|软件|电子信息|电气|机械|自动化|土木|材料|能源|交通|航空|化工|环境|测绘|仪器|建筑|食品|制药|工程/, '工学'],
    [/农学|林学|植物|动物|园艺/, '农学'], [/医学|临床|口腔|护理|药学|中医/, '医学'], [/艺术|设计|音乐|美术|戏剧|影视/, '艺术学'], [/哲学/, '哲学'],
  ];
  const disciplineOf = (category, major) => (DISCIPLINE.find(([re]) => re.test(category || major)) || [])[1] || '';

  // supplement：你在网页上补答、资料里原本空着的项（如 GPA），记成资料补充，所有网站通用。资料本身有值时以资料为准。
  function applySupplement(f, sup) {
    for (const [k, v] of Object.entries(sup || {})) {
      if (v == null || v === '') continue;
      const [a, b, c] = k.split('.');
      if (a === 'sem') { if (!f[b]) f[b] = v; continue; }
      const item = (f.lists[a] || [])[+b];
      if (item && c && !item[c]) item[c] = v;
    }
    return f;
  }

  function facts(profile, supplement) {
    const p = profile || {};
    const L = lists(p);
    // 最快到岗 / 计划入职时间：最近一段学习结束后的下个月 1 号（应届生毕业就能入职）。用户在两家公司都这么填过（2026-10-13）。
    const end = (L.edu[0]?.end || '').match(/^(\d{4})[-/.年](\d{1,2})/);
    const available = end ? (+end[2] === 12 ? `${+end[1] + 1}-01-01` : `${end[1]}-${String(+end[2] + 1).padStart(2, '0')}-01`) : '';
    // “工作经历”块在校招表里装的多半是实习：没有正式工作经历时用实习顶上（以前的引擎也是这条规则）。
    if (!L.work.length) L.workOrIntern = L.intern; else L.workOrIntern = L.work;
    // 年龄：按今天算周岁（飞书等直接问“年龄”）
    const b = (single(p).birthDate || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/), t = today().split('-').map(Number);
    const age = b ? String(t[0] - +b[1] - (t[1] < +b[2] || (t[1] === +b[2] && t[2] < +b[3]) ? 1 : 0)) : '';
    const endY = end ? +end[1] : 0;
    const presence = Object.fromEntries(Object.entries(L).map(([key, list]) => ['has_' + key, list.length ? '是' : '否']));
    const certificatesText = L.cert.map(x => [x.name, x.date, x.score ? '成绩：' + x.score : ''].filter(Boolean).join('，')).join('\n');
    return applySupplement({ ...single(p), ...presence, certificatesText, availableDate: available, age, classOf: endY ? `${endY}届` : '', discipline: L.edu[0]?.discipline || '', lists: L }, supplement);
  }

  AF.profile = { facts };
})();
