// 字段 → 语义：唯一说“这个问题对应资料里哪一项”的地方。
//   1. 平台内置字段按 id 精确对应（platforms/*.js 里的表，最可靠）；
//   2. 自定义字段按问题文字对应（下面的规则表，必须整句命中，宁缺毋滥）；
//   3. 都对不上 → 交给 AI（engine.js），AI 的回答按平台字段 id 缓存，同一平台下次不再问。
// 规则写成数据表，新平台、新问法只加一行，不改流程。
(() => {
  if (globalThis.AF?.mapping) return;
  const AF = (globalThis.AF ||= {});

  // 去掉空白、星号、冒号和末尾括号说明——但“（年）（月）”是问法本身，要先换成文字保留下来
  const clean = s => String(s ?? '').replace(/[\s*＊:：]+/g, '').replace(/[（(](年|年度)[)）]$/, '年').replace(/[（(](月|每月)[)）]$/, '月').replace(/[（(].*?[)）]$/, '');

  // 单值问题。问题文字整句匹配（去掉空白、星号、末尾括号说明）。
  const SINGLE = [
    [/^(姓名|真实姓名|中文姓名|名字)$/, 'name'], [/^性别$/, 'gender'], [/^(出生日期|出生年月|生日)$/, 'birthDate'], [/^年龄$/, 'age'],
    [/^(手机|手机号|手机号码|联系电话|移动电话)$/, 'phone'], [/^(邮箱|电子邮箱|email|e-mail)$/i, 'email'],
    [/^(国籍|国家\/地区|国家|国籍\/地区)$/, 'nationality'], [/^民族$/, 'ethnicity'], [/^政治面貌$/, 'political'],
    [/^(婚姻状况|婚否|婚姻)$/, 'marital'], [/^身高(cm)?$/i, 'height'], [/^体重(kg)?$/i, 'weight'], [/^健康状况$/, 'health'],
    [/^(籍贯|籍贯地)$/, 'hometown'], [/^(户口所在地|户籍所在地|户籍地址|户口地址|户籍|户籍地|户口)$/, 'hukou'], [/^生源地$/, 'sourceLocation'],
    [/^(现居住地|现居地|现住址|目前所在地|现所在地|当前所在地|所在城市|居住地|所在地)$/, 'currentCity'],
    [/^(通讯地址|联系地址|邮寄地址|家庭住址)$/, 'address'],
    [/^(证件类型)$/, 'idType'], [/^(身份证号|身份证号码|证件号码|证件号)$/, 'idNumber'],
    [/^(紧急联系人|紧急联系人姓名)$/, 'emergencyName'], [/^紧急联系人?(电话|手机|联系方式|联系电话)$/, 'emergencyPhone'],
    [/^(期望薪资|期望月薪|期望薪酬|期望薪酬月|期望薪资月|期望月薪资)$/, 'expectedSalary'], [/^(期望年薪|期望年收入|期望年薪资|期望薪酬年|期望薪资年)$/, 'expectedSalaryAnnual'],
    // 意向城市：按资料里的城市优先级挑（engine.js 城市优先级），不是某一个固定值
    [/^(意向|期望)(工作)?(城市|地点|工作地点|工作地)\d*$|^第[一二三123]意向城市$|^(工作城市|意向城市[一二三123]?)$/, 'cityPref'],
    [/调剂$/, 'acceptAdjustment'], [/^工作年限$|^工作经验$/, 'yearsOfWork'], [/^(驾驶执照|驾驶证)$/, 'licenseType'], [/^(是否(愿意|接受|服从)调剂|服从调剂|接受调剂)$/, 'acceptAdjustment'],
    [/^(应届\/往届|应届往届|毕业生类型|是否应届生?)$/, 'graduateType'],
    [/^(驾驶技能|驾照类型|准驾车型|驾照)$/, 'licenseType'], [/^(是否有驾照|有无驾照|是否持有驾照)$/, 'license'],
    [/^(英语等级|英语水平|外语等级|英语)$/, 'englishLevel'], [/^(语种|外语语种)$/, 'languageType'],
    [/^(it技能|计算机技能|专业技能|技能特长|技能)$/i, 'skills'], [/^(兴趣爱好|爱好)$/, 'interests'],
    [/^(英语成绩|英语分数|英语等级成绩|英语考试成绩|六级成绩|四级成绩|cet-?[46]成绩)$/i, 'englishScore'],
    [/^(计划入职时间|预计入职时间|最快可?到岗时间|可到岗时间|预计到岗时间|到岗时间|预计报到时间|最早到岗时间|可入职时间|可以到岗时间|可到岗日期|到岗日期|最快到岗日期|可入职日期)$/, 'availableDate'],
    [/^英语(等级)?(分数|成绩|得分)$/, 'englishScore'],
    // 2026-10-13 用户在 Moka 手填过的：毕业届别 2027届、学科门类 管理学
    [/^(毕业届别|届别|毕业届次|应届届别|毕业年份届别)$/, 'classOf'], [/^(学科门类|专业学科门类|最近毕业专业学科门类|所学学科门类|专业门类|学科类别)$/, 'discipline'],
    // 资料里没有的其他语种：明确“没有”，不让 AI 拿英语去顶（Moka“日语水平”曾被认成语种=英语）
    [/^(日语|韩语|法语|德语|俄语|西班牙语|意大利语|葡萄牙语|阿拉伯语|小语种)(水平|等级|能力|掌握程度)?$/, 'none'],
  ];
  // 经历条目里的问题：只在对应的块里生效。
  const LIST = {
    edu: [[/^(学校|学校名称|毕业院校|院校名称|毕业学校)$/, 'school'], [/^(专业|专业名称|所学专业)$/, 'major'], [/^(学历|最高学历|学历层次)$/, 'degree'],
      [/^(学位)$/, 'degree'], [/^(学习形式|培养方式|学习方式|教育类型|办学形式)$/, 'studyMode'], [/^(院系|学院|学院名称|所在院系)$/, 'faculty'],
      [/^(gpa|成绩\(gpa\)|绩点)$/i, 'gpa'], [/^(专业人数|本专业人数|专业总人数|专业学生人数)$/, 'majorSize'], [/排名/, 'ranking'], [/^(主修课程|主要课程|专业课程)$/, 'courses'], [/^(专业类别|学科门类)$/, 'majorCategory'],
      [/^(开始时间|入学时间|起始时间)$/, 'start'], [/^(结束时间|毕业时间|毕业年月|毕业日期)$/, 'end'],
      [/^(国家\/地区|国家|所在国家|国家或地区|学校所在国家\/地区|院校所在国家\/地区)$/, 'country'],
      [/^是否最高学历$/, 'isHighest'], [/^是否第一学历$/, 'isFirst'], [/^是否(已)?毕业$/, 'graduated'], [/^是否全日制$/, 'fullTime']],
    intern: [[/^(工作国家\/地区|国家\/地区|国家|所在国家|国家或地区)$/, 'country'], [/^(工作性质|工作类型|经历类型|职位性质|雇佣类型)$/, 'nature'],
      [/^(公司|公司名称|单位名称|实习单位|企业名称)$/, 'company'], [/^(职位|职位名称|岗位|岗位名称|职务)$/, 'title'], [/^(离职原因|离开原因)$/, 'leaveReason'],
      [/^(工作职责|实习内容|工作内容|职责描述|工作描述)$/, 'desc'], [/^(开始时间|入职时间)$/, 'start'], [/^(结束时间|离职时间)$/, 'end']],
    project: [[/^(项目名称|科研项目名称|名称)$/, 'name'], [/^(职务|担任职务|角色|项目角色)$/, 'role'], [/^(项目描述|项目内容)$/, 'desc'],
      [/^(开始时间)$/, 'start'], [/^(结束时间)$/, 'end']],
    campus: [[/^(组织名称|社团名称|实践名称|活动名称|组织)$/, 'org'], [/^(职务|职务名称|担任职务|角色)$/, 'role'],
      [/^(描述|实践描述|职务描述|活动描述|经历描述)$/, 'desc'], [/^(开始时间)$/, 'start'], [/^(结束时间)$/, 'end']],
    cert: [[/^(证书名称|证书)$/, 'name'], [/^(获得时间|获证时间|颁发时间|获取年月|获得年月|获取时间)$/, 'date'], [/^(分数|成绩)$/, 'score']],
    family: [[/^(姓名)$/, 'name'], [/^(关系|称谓|与本人关系)$/, 'relation'], [/^(工作单位|单位)$/, 'company'], [/^(职务|职位)$/, 'title'], [/^(电话|联系电话|手机)$/, 'phone']],
  };
  LIST.work = LIST.intern; LIST.workOrIntern = LIST.intern;

  // 个人信息里问的“最高学历/毕业学校/毕业时间”：就是资料第一条教育经历（按时间由近到远排）
  const EDU0 = [[/^(最高学历|学历)$/, 'degree'], [/^(最高学位|学位)$/, 'degree'], [/^(毕业学校|毕业院校|最高学历毕业院校)$/, 'school'],
    [/^(毕业时间|毕业日期|毕业年月|预计毕业时间)$/, 'end'], [/^(所学专业|最高学历专业)$/, 'major'],
    // 个人信息里问的学习形式（中交“学习形式”、英诺赛科“就读方式”，2026-10-13 都是用户手填的）
    [/^(学习形式|培养方式|就读方式|学习方式|最高学历学习形式)$/, 'studyMode'], [/^是否全日制$/, 'fullTime'],
    [/^(gpa|gpa成绩|成绩gpa|平均绩点|绩点|学分绩点|平均学分绩点)$/i, 'gpa'], [/^(专业排名|成绩排名|学习成绩排名|专业内成绩排名)$/, 'ranking'],
    [/^((最高学历)?(院校|学校)所属(地区|国家)|(院校|学校)所在(国家|地区)|(最高学历)?(院校|学校)国家\/地区)$/, 'country']];
  // 声明类是非题：默认“否”。只认“是否/有无”开头的问法，“如有请说明”这类说明框不碰。
  const DECLARE = /(退伍|军人|服役|犯罪|刑事|违法|违纪|处分|吸毒|传染病|精神(病|疾病)|重大(疾病|病史)|慢性|遗传|病史|疾病|子女|内部推荐|内推|他人推荐|签证|工作许可|残疾|职业病|被(开除|辞退|解聘)|竞业|劳动(仲裁|纠纷)|亲[戚属].{0,6}(我司|本公司|公司|集团|单位)|(认识|熟人).{0,6}(本公司|我司|公司|职员|员工)|(曾|服务于|就职于|任职于).{0,4}(本公司|我司))/;

  // 按问题文字猜：返回 { sem } 或 { list, prop[, row] }；猜不到返回 null。
  function byLabel(label, list) {
    const t = clean(label);
    if (list) { const hit = (LIST[list] || []).find(([re]) => re.test(t)); if (hit) return { list, prop: hit[1] }; }
    if (['edu', 'intern', 'work', 'workOrIntern', 'project', 'campus'].includes(list)) {
      if (/^(开始日期|起始日期)$/.test(t)) return { list, prop: 'start' };
      if (/^(结束日期|截止日期)$/.test(t)) return { list, prop: 'end' };
    }
    if (/^(是否|有无|有没有)/.test(t) && DECLARE.test(t)) return { sem: 'declareNo' };
    const hit = SINGLE.find(([re]) => re.test(t));
    if (hit) return { sem: hit[1] };
    const e = !list && EDU0.find(([re]) => re.test(t));
    return e ? { list: 'edu', prop: e[1], row: 0 } : null;
  }

  // 问题文字对不上时再看段落：“英语能力 / 语言能力”段落里的“得分”“证书”是英语的（Hotjob 等实测）
  function bySection(label, section) {
    const t = clean(label), sec = String(section || '');
    if (/语言|英语|外语/.test(sec)) {
      if (/^(得分|分数|成绩|考试成绩|总分)$/.test(t)) return { sem: 'englishScore' };
      if (/^(语言证书|证书名称|等级证书|证书|等级|考试类型|证书类型)$/.test(t)) return { sem: 'englishLevel' };
      if (/^(语种|语言类型|语言|外语语种)$/.test(t)) return { sem: 'languageType' };
    }
    return null;
  }

  // 目标 → 资料里的值。经历条目没有这一条（资料只有 2 条，网页有 3 条）返回 undefined，表示“不该填”。
  function valueOf(target, facts, row = 0) {
    if (!target) return undefined;
    if (target.sem) return facts[target.sem] || '';
    const item = (facts.lists[target.list] || [])[target.row ?? row];
    if (!item) return undefined;
    if (target.prop === 'range') return item.start || item.end ? { start: item.start, end: item.end } : '';
    return item[target.prop] ?? '';
  }

  // 地区写进普通输入框时按问题要的粒度：问“省份”只写省，问“城市”写到市（直辖市就是它自己），其余写完整的“省市区”。
  const REGION_SEM = new Set(['hometown', 'hukou', 'currentCity', 'sourceLocation']);
  function regionText(label, value) {
    const hit = AF.region?.resolve(AF.region.gb(), value);
    if (!hit) return value;
    const p = hit.path, t = clean(label);
    if (/省份|^省$|所在省/.test(t)) return p[0];
    if (/城市|所在市|^市$/.test(t)) return p[1] || p[0];
    return p.join('');
  }

  // 资料对应不上的问题怎么处理：开放题（多行文字）交给 AI 依资料写；其余（面试站点、申请职位、从何途径得知、到岗时间……）
  // 每家公司不一样、资料里也没有，AI 只能瞎猜（2026-10 明阳“面试站点”被猜成“其他学校”），所以空着留给你，
  // 你填过并“记住”后下次自动填。
  const aiAllowed = kind => kind === 'textarea';

  // 意向城市：prefs 按优先级（“上海”“深圳”“浙江”…）；省份也算——优先级里有“浙江”，选项里的“杭州”“绍兴”都能选。
  // kind：region（地区选择器，tree 是平台地区表）/ select（options 是选项文字）/ 其它（输入框直接写）。used 里是已经填过的城市。
  function pickCity(kind, options, prefs, used = new Set(), tree = null) {
    const gb = AF.region.gb(), same = AF.region.same, core = AF.region.core;
    const inside = (opt, pref) => { const r = AF.region.resolve(gb, opt), p = AF.region.resolve(gb, pref); return !!r && !!p && r.depth >= p.depth && r.path.slice(0, p.depth).every((x, i) => same(x, p.path[i])); };
    for (const pref of prefs) {
      if (used.has(core(pref))) continue;
      if (kind === 'region') { if (AF.region.resolve(tree || gb, pref)) return pref; continue; }
      if (kind === 'select') {
        const hit = options.find(o => same(o, pref)) || options.find(o => !used.has(core(o)) && inside(o, pref));
        if (hit) return hit;
        continue;
      }
      return pref;
    }
    return null;
  }

  // 资料值在网页选项里对不上时，退一级再试（专业类别：工商管理类 → 管理学；Moka 的“专业类别”选项是学科门类）
  function alternatives(target, facts, row = 0) {
    if (target?.prop === 'majorCategory') { const v = valueOf({ list: 'edu', prop: 'discipline', row: target.row }, facts, row); return v ? [v] : []; }
    return [];
  }

  AF.mapping = { bySection, alternatives, byLabel, valueOf, clean, regionText, aiAllowed, pickCity, REGION_SEM, SINGLE, LIST };
})();
