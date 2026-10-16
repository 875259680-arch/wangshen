// 后台：唯一的数据源（资料 / 记住的回答 / AI 缓存 / 设置 / 简历文件）+ AI 调用 + 帧间转发。
const norm = s => String(s ?? '').toLowerCase().replace(/[\s*＊:：()（）[\]【】'"“”‘’,，.。、;；!！?？\/\\|_~—-]/g, '');
// 旧版 Chrome/Edge（< 99）的 tabs/runtime 消息接口不返回 Promise：统一包成回调形式。
const tabSend = (tabId, msg, opts = {}) => new Promise((ok, bad) => chrome.tabs.sendMessage(tabId, msg, opts, r => { const e = chrome.runtime.lastError; e ? bad(e) : ok(r); }));
const activeTab = () => new Promise(ok => chrome.tabs.query({ active: true, currentWindow: true }, tabs => ok(tabs?.[0])));
const store = {
  get: keys => chrome.storage.local.get(keys),
  set: obj => chrome.storage.local.set(obj),
};

// 代码更新只初始化默认设置；资料、附件和学习仅从本地存储或显式导入读取。
// 禁止安装包内 seed 在更新时覆盖用户资料。
async function initializeDefaults() {
  const { settings } = await store.get('settings');
  if (!settings) await store.set({ settings: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', autoExpand: true } });
}
chrome.runtime.onInstalled.addListener(initializeDefaults);
chrome.runtime.onStartup.addListener(initializeDefaults);
importScripts('core/text.js', 'core/memory.js', 'core/diag.js');
let mutationQueue = Promise.resolve();
const MUTATIONS = new Set(['DIAG', 'LEARN', 'MEM_SAVE', 'MEM_DELETE', 'SUPPLEMENT_SAVE', 'SUPPLEMENT_DELETE', 'CITY_ADD', 'DEV_SET']);

// ---------- 记忆与缓存的 key ----------
// 每个回答都按“板块 + 问题 + 第几条”存，长题目也不能跨经历复用。
// 段落名归到通用类别：京东“基本信息”和扬子江“个人信息”是同一类，记忆才能跨站复用。
const BUCKETS = [[/家庭|家属|亲属|紧急/, '家庭'], [/教育|学历|学习经历/, '教育'], [/实习.*工作|工作.*实习/, '工作实习'], [/实习/, '实习'], [/工作|职业|任职/, '工作'], [/项目|科研/, '项目'],
  [/校园|学生|社团|社会实践|活动/, '校园'], [/证书|技能|语言|外语|资格/, '技能'], [/获奖|荣誉|奖励/, '获奖'], [/个人|基本|基础|联系|身份/, '个人']];
const bucket = sec => (BUCKETS.find(([re]) => re.test(sec || '')) || [0, 'section:' + norm(sec)])[1];
const scopeField = (f, page = {}) => ({ ...f, scope: AF.memory.pageScope(page) });
const answerKey = f => `${norm(f.label)}#${f.row || 0}#${f.part || 0}@${bucket(f.section)}${AF.memory.needsScope(f.label) && f.scope ? `@scope:${f.scope}` : ''}`;
const rememberedAnswer = (answers, f) => Object.values(answers).filter(a =>
  norm(a.label) === norm(f.label) && bucket(a.section) === bucket(f.section) &&
  (a.row || 0) === (f.row || 0) && (a.part || 0) === (f.part || 0) &&
  (!AF.memory.needsScope(f.label) || (!!f.scope && a.scope === f.scope))
).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
const cacheKey = (f, rev, page = {}) => {
  const parts = [page.host || '', rev, norm(f.section), norm(f.label), f.row, f.part, f.kind, norm((f.options || []).join('|')).slice(0, 200)];
  if (AF.memory.needsScope(f.label)) parts.push(AF.memory.pageScope(page));
  return parts.join('|');
};

// ---------- 隐私：身份证、电话、邮箱不发给 AI，用占位符代替 ----------
function redact(profile) {
  const secrets = {}; let n = 0;
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string' && x && /idnumber|phone|mobile|tel$|email/i.test(k)) { const t = `[[S${++n}]]`; secrets[t] = x; o[k] = t; }
        else o[k] = walk(x);
      }
      return o;
    }
    return v;
  };
  return { profile: walk(profile), secrets };
}
const unredact = (v, secrets) => typeof v === 'string' ? v.replace(/\[\[S\d+\]\]/g, t => secrets[t] ?? '') : v;

// ---------- AI ----------
const SYSTEM = `你是网申表单填写助手。根据【候选人资料】和【已记住的回答】，为【表单字段】逐个给出要填写的值。
规则：
1. 只使用资料中明确的事实，或能直接推出的值（如由出生日期算年龄、第一条教育经历即最高学历）。绝不编造；资料里没有就返回 null。
2. section 是字段所在段落，row 是该段落里第几条（从 0 开始），对应资料列表的第 row+1 条：教育→educations，实习→internships，工作→workExperiences（为空时用 internships），项目→projects，校园/学生工作/社团/活动→campusExperiences，证书/资格→certificates，家庭→familyMembers。该条不存在就返回 null。
3. 有 options 的字段必须原样返回其中一个选项的文字；都不合适返回 null。多选用“、”连接。
4. kind=select 且没有 options 时，返回最可能出现在下拉里的规范叫法（如“硕士”“汉族”“英语”“中国”）。籍贯、户口、所在地等地区问题一律返回资料里的完整“省/市/区”路径（不要只给省），网页层级少时程序会自动截断。学校、专业返回全称。
5. 日期返回 YYYY-MM（资料有具体日时 YYYY-MM-DD；资料只有年月而网页要求具体日期时，日取 01）。kind=daterange 返回“开始 ~ 结束”。结束时间：资料有 endDate 就用 endDate（即使在未来，如预计毕业时间 2027-06，也不要写“至今”）；只有 isCurrent 为 true 且 endDate 为空的经历才返回“至今”，不要用今天的日期代替。同一问题有两个框时 part=0 是开始、part=1 是结束；有四个框时依次是 开始年、开始月、结束年、结束月，年返回如“2025”，月返回不补零的数字如“9”。
6. 有 maxLength 的文字必须不超过该长度，可精简措辞但不能改变事实。
7. 是非题返回“是”或“否”；单个勾选框（如“至今”）按事实返回“是”或“否”，不要返回 null。开放问题（自我评价、职业规划、为什么投递等）依据资料写真实、简洁的回答，150 字以内。
8. 资料中形如 [[S1]] 的占位符代表隐私值，需要时原样返回占位符。
9. 已记住的回答是用户以前亲手填写的，问题意思相同就优先使用。
10. 经历类字段对应关系：名称/单位/公司/学校/组织/活动名称 → company、school、organization、name；职务/职位/角色 → title、role；描述/内容/职责 → description。不要把职务填进名称里。
11. 专业类别/学科门类取 majorCategory；有 options 时选最接近的一项。
12. 驾照：问“有无驾照/驾驶技能”且选项是有/无时答“有”；选项是车型时按 driversLicenseType 选（C1 对应“C照/C1/小型汽车”）。
13. 排名/区间类选项：选包含该值的最小区间（前10% → 前20%，前15% → 前20%），不要因为没有完全相同的选项就返回 null。
只输出 JSON：{"values": {"字段key": 值或null}}，必须包含每个字段的 key。`;

// ---------- AI 连通性 ----------
// 公司网络常拦截 AI 接口：被拒时立刻失败，静默丢包时要等到超时（一批 60 秒、每个下拉 20 秒）。
// 真正的请求照常立即发出，同时并行探一下接口（任何 HTTP 响应都算通）：探不通就提前取消请求、改走本地规则，
// 并在 10 分钟内不再尝试。正常网络下不增加任何等待；静默丢包时最多等 10 秒而不是 60 秒。
let aiDownUntil = 0, aiOkAt = 0;
const OFFLINE_MSG = '连不上 AI 接口（公司网络可能拦截了它）：已用本地规则填写能确定的字段，其余请手动填写。网络恢复后会自动重新使用 AI。';
const isNetErr = e => e?.name === 'TimeoutError' || e?.name === 'AbortError' || e instanceof TypeError;
const baseOf = settings => (settings.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
async function aiReachable(settings) {
  if (Date.now() < aiDownUntil) return false;
  if (Date.now() - aiOkAt < 10 * 60e3) return true;
  try {
    await fetch(baseOf(settings) + '/models', { headers: { Authorization: `Bearer ${settings.apiKey}` }, signal: abortAfter(10000) });
    aiOkAt = Date.now();
    return true;
  } catch (_) {
    aiDownUntil = Date.now() + 10 * 60e3;
    return false;
  }
}
const HTTP_MSG = { 401: 'API Key 无效，请在设置页检查', 402: 'AI 账户余额不足', 429: 'AI 请求太频繁，请稍后再试' };

// 旧版浏览器没有 AbortSignal.any：超时和外部取消合成一个信号。
function abortAfter(ms, outer) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  outer?.addEventListener('abort', () => c.abort());
  if (outer?.aborted) c.abort();
  c.signal.addEventListener('abort', () => clearTimeout(t));
  return c.signal;
}
async function chat(settings, system, user, timeout = 60000, cancel) {
  if (!settings.apiKey) throw Error('未设置 API Key');
  const base = baseOf(settings);
  const body = {
    model: settings.model || 'deepseek-flash', temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }],
  };
  if (/deepseek/.test(base)) body.thinking = { type: 'disabled' };
  let r;
  try {
    r = await fetch(base + '/chat/completions', {
      method: 'POST', signal: abortAfter(timeout, cancel),
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (isNetErr(e)) { aiDownUntil = Date.now() + 10 * 60e3; throw Object.assign(Error(OFFLINE_MSG), { offline: true }); }
    throw e;
  }
  aiOkAt = Date.now();
  if (!r.ok) throw Error(HTTP_MSG[r.status] || `AI 接口返回 ${r.status}：${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content || '{}';
  return JSON.parse(txt.replace(/^```(?:json)?|```$/g, ''));
}

// 本地规则一定答得对的问题：问题文字就是这几个说法本身，或经历条目里的短问题（学校、专业、开始时间……）。
// 这些不必等 AI：先填，AI 只回答剩下的。宽松规则（“出生”也会命中“出生地”）只在 AI 不可用时兜底。
const SURE_LABEL = /^(姓名|真实姓名|中文姓名|名字|性别|出生日期|出生年月|生日|手机|手机号|手机号码|联系电话|移动电话|邮箱|电子邮箱|email|e-mail|身份证号|身份证号码|证件号码|证件号|民族|政治面貌|婚姻状况|婚否|籍贯|户口所在地|户籍所在地|生源地|目前所在地|现居住地|现居地|所在城市|当前所在地|现所在地|居住地|国籍|最高学历|毕业院校|毕业学校)$/;
const sureLocal = f => {
  const label = norm(f.label);
  if (SURE_LABEL.test(label)) return true;
  // 经历条目里的短问题由 localGuess 按第几条精确取值；长问题（“请描述你在该项目中的贡献”）交给 AI。
  return LIST_OF.some(([re]) => re.test(f.section || '')) && label.length <= 6;
};

// phase=fast：只用记忆、缓存和“一定答得对”的本地规则，立刻返回，其余列在 pending 里；
// phase 省略：完整流程（记忆 → 缓存 → AI → 本地兜底）。引擎先按 fast 开填，同时把 pending 交给 AI，填写和 AI 等待重叠。
async function resolve(fields, page, phase) {
  fields = fields.map(f => scopeField(f, page));
  const { profile = {}, profileRev = 0, answers = {}, cache = {}, settings = {} } = await store.get(['profile', 'profileRev', 'answers', 'cache', 'settings']);
  const values = {}, source = {}, rest = [];
  for (const f of fields) {
    const a = rememberedAnswer(answers, f);
    const c = cache[cacheKey(f, profileRev, page)];
    if (a && (!f.options?.length || f.options.some(o => norm(o) === norm(a.value)))) { values[f.key] = a.value; source[f.key] = '记忆'; }
    else if (c !== undefined) { values[f.key] = c; source[f.key] = '缓存'; }
    else rest.push(f);
  }
  if (phase === 'fast' && settings.apiKey && Date.now() >= aiDownUntil) {
    const sure = rest.filter(sureLocal);
    const got = localGuess(sure, profile);
    const pending = [];
    for (const f of rest) {
      if (got[f.key] != null) { values[f.key] = got[f.key]; source[f.key] = '本地规则'; }
      else pending.push(f.key);
    }
    return { values, source, pending, offline: [] };
  }
  let error;
  const offline = [];   // AI 没能回答、只能靠本地规则的字段：本地也没认出时，告诉用户是“AI 不可用”而不是“资料里没有”
  const useLocal = list => {
    const got = localGuess(list, profile);
    for (const f of list) { if (got[f.key] != null) { values[f.key] = got[f.key]; source[f.key] = '本地规则'; } else offline.push(f.key); }
  };
  if (rest.length) {
    if (!settings.apiKey) {
      error = '未设置 AI Key：已用本地规则填写能确定的字段，其余请手动填写（可在设置页填入 Key）';
      useLocal(rest);
    } else if (Date.now() < aiDownUntil) {
      error = OFFLINE_MSG;
      useLocal(rest);
    } else {
      const { profile: safe, secrets } = redact(profile);
      const remembered = Object.values(answers).slice(-200).map(a => ({ section: a.section, label: a.label, row: a.row, value: a.value }));
      const today = new Date().toISOString().slice(0, 10);
      const batches = [];
      for (let i = 0; i < rest.length; i += 45) batches.push(rest.slice(i, i + 45));
      const cancel = new AbortController();
      aiReachable(settings).then(ok => { if (!ok) cancel.abort(); });
      const outs = await Promise.allSettled(batches.map(b => chat(settings, SYSTEM, { today, page, profile: safe, remembered, fields: b }, 60000, cancel.signal)));
      const newCache = {};
      outs.forEach((o, i) => {
        if (o.status === 'rejected') { error = o.reason.message; useLocal(batches[i]); return; }
        const got = o.value.values || o.value;
        for (const f of batches[i]) {
          let v = got[f.key];
          if (v != null && typeof v !== 'string') v = Array.isArray(v) ? v.join('、') : String(v);
          v = v == null || /^(null|无|none|n\/a)$/i.test(v.trim()) ? null : unredact(v.trim(), secrets);
          values[f.key] = v; source[f.key] = 'AI';
          newCache[cacheKey(f, profileRev, page)] = v;
        }
      });
      // 缓存上限 3000 条，旧的先丢。
      const merged = { ...cache, ...newCache };
      const keys = Object.keys(merged);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete merged[k];
      await store.set({ cache: merged });
    }
  }
  return { values, source, error, offline };
}

// ---------- 本地规则：AI 连不上（公司网络拦截、没配 Key）时的保底 ----------
// 覆盖整份资料：个人信息、教育/实习/项目/校园/证书/家庭各条目（按 row 对应第几条）、日期、起止范围、四框年月。
// 宁可留空也不填错：问题文字必须明确命中才填，拿不准的交给人工。
const LIST_OF = [[/家庭|家属|亲属/, 'familyMembers'], [/教育|学历|学习经历/, 'educations'], [/实习/, 'internships'], [/工作|职业|任职/, 'workExperiences'],
  [/项目|科研/, 'projects'], [/校园|学生|社团|社会实践|活动|在校/, 'campusExperiences'], [/证书|资格/, 'certificates']];
const ym = d => (String(d || '').match(/^(\d{4})-(\d{1,2})/) || []);
function localGuess(fields, p) {
  const P = p.personal || {}, C = p.contactAndLocation || {}, I = p.identityAndAuthorization || {}, J = p.jobPreferences || {},
    S = p.skills || {}, L = p.languageFacts || {}, E = p.educations || [];
  const has = (re, t) => re.test(t);
  // 起止时间类：按控件形态给值。四个框（年、月、年、月）靠选项判断是年还是月。
  const dateFor = (f, item, label) => {
    const start = item.startDate || '', end = item.endDate || (item.isCurrent ? '至今' : '');
    const yearOpts = (f.options || []).filter(o => /^(19|20)\d{2}\s*年?$/.test(o)).length >= 3;
    const monthOpts = (f.options || []).filter(o => /^\d{1,2}\s*月?$/.test(o)).length >= 6;
    const which = /开始|入学|入职|起始|^从/.test(label) ? 0 : /结束|毕业|离职|截止|至今|^至/.test(label) ? 1 : null;
    if (yearOpts || monthOpts) {
      const isEnd = which != null ? which === 1 : f.part >= 2;
      const [, y, m] = ym(isEnd ? end : start);
      if (!y) return null;
      return yearOpts ? y : String(+m);
    }
    if (which === 0) return start || null;
    if (which === 1) return end || null;
    if (f.kind === 'daterange') return start && end ? `${start} ~ ${end}` : null;
    if (f.part === 1) return end || null;
    return start || null;   // 只有一个框又叫“时间”：多为开始时间
  };
  const out = {};
  for (const f of fields) {
    const label = String(f.label || ''), sec = String(f.section || '');
    let v = null;
    let listName = (LIST_OF.find(([re]) => re.test(sec)) || [])[1];
    if (listName === 'workExperiences' && !(p.workExperiences || []).length) listName = 'internships';
    const item = listName ? (p[listName] || [])[f.row || 0] : null;
    // 驾驶资格是个人事实；混合“语言/证书/技能”标题以前会把它当成某一张证书，导致明明有资料却漏答。
    if (/驾照|驾驶|准驾|车型/.test(label) && !/时间|日期|年限|经验|描述|说明/.test(label)) {
      const yesNo = /是否|有无|有没有/.test(label) || (f.options || []).some(o => /^(有|是)$/.test(o)) && (f.options || []).some(o => /^(无|否)$/.test(o));
      v = yesNo || /^(无|否|没有|no|false)$/i.test(String(I.driversLicense)) ? I.driversLicense : I.driversLicenseType || I.driversLicense;
    } else if (listName) {
      if (!item) continue;   // 资料里没有这一条
      const timeQ = /时间|日期|年月|起止|期间|入学|毕业|入职|离职|^(开始|结束)/.test(label) && !/毕业院校|毕业学校/.test(label);
      // 经历旁边的“至今/在职/在读”勾选框：资料能确定，以前没规则，没 AI 时只能交给人工。
      if (/^(至今|至今在职|在职|在读|目前在职|仍在职|当前在职)$/.test(label) && f.kind === 'checkbox') { out[f.key] = item.isCurrent && !item.endDate ? '是' : '否'; continue; }
      if (listName === 'educations') {
        if (timeQ) v = dateFor(f, item, label);
        else if (has(/学校|院校/, label)) v = item.school;
        else if (has(/专业类别|学科门类|专业大类/, label)) v = item.majorCategory;
        else if (has(/专业/, label) && !has(/排名|方向|课程/, label)) v = item.major;
        else if (has(/学历|学位|层次/, label)) v = item.degree;
        else if (has(/学习形式|培养方式|学习方式|办学形式|教育类型|统招/, label)) v = item.studyMode;
        else if (has(/院系|学院|系别/, label)) v = item.faculty;
        else if (has(/排名/, label)) v = item.ranking;
        else if (has(/gpa|绩点/i, label)) v = item.gpa;
        else if (has(/课程/, label)) v = item.courses;
      } else if (listName === 'internships' || listName === 'workExperiences') {
        if (timeQ) v = dateFor(f, item, label);
        else if (has(/公司|单位|企业|机构/, label) && !has(/性质|规模|类型|行业/, label)) v = item.company;
        else if (has(/职位|岗位|职务|职称/, label)) v = item.title;
        else if (has(/描述|内容|职责|工作业绩|主要工作/, label)) v = item.description;
      } else if (listName === 'projects') {
        if (timeQ) v = dateFor(f, item, label);
        else if (has(/名称|项目名/, label)) v = item.name;
        else if (has(/角色|职务|担任/, label)) v = item.role;
        else if (has(/描述|内容|职责/, label)) v = item.description;
      } else if (listName === 'campusExperiences') {
        if (timeQ) v = dateFor(f, item, label);
        else if (has(/组织|社团|名称|单位/, label)) v = item.organization;
        else if (has(/职务|角色|担任/, label)) v = item.role;
        else if (has(/描述|内容|职责/, label)) v = item.description;
      } else if (listName === 'certificates') {
        if (has(/时间|日期/, label)) v = item.issueDate;
        else if (has(/分数|成绩/, label)) v = item.score;
        else if (has(/类别|类型/, label)) v = item.category;
        else if (has(/名称|证书/, label)) v = item.name;
      } else if (listName === 'familyMembers') {
        if (has(/姓名|名字/, label)) v = item.name;
        else if (has(/关系|称谓/, label)) v = item.relationship;
        else if (has(/单位|公司/, label)) v = item.company;
        else if (has(/职务|职位/, label)) v = item.title;
        else if (has(/电话|手机|联系方式/, label)) v = item.phone;
      }
    } else {
      const rules = [
        [/紧急联系人.*(电话|手机|方式)/, C.emergencyContactPhone], [/紧急联系人/, C.emergencyContactName],
        [/^(姓名|名字|真实姓名|中文名|name|full ?name)$/i, P.fullName], [/^性别$|gender/i, P.gender],
        [/出生|生日|birth/i, P.birthDate], [/^年龄$/, P.birthDate ? String(Math.floor((Date.now() - new Date(P.birthDate)) / 3.15576e10)) : null],
        [/手机|移动电话|联系电话|^电话|mobile|phone/i, P.phoneNumber], [/邮箱|e-?mail/i, P.email],
        [/身份证号|证件号/, I.personalIdNumber], [/证件类型/, I.personalIdType],
        [/^民族$/, P.ethnicity], [/政治面貌/, P.politicalStatus], [/婚姻|婚否/, P.maritalStatus],
        [/^身高/, P.height], [/^体重/, P.weight], [/国籍/, P.nationality], [/健康/, P.healthStatus],
        [/籍贯/, C.hometownCity], [/户口|户籍/, C.hukouLocation], [/生源地/, C.sourceLocation],
        [/现居|居住地|所在城市|所在地|现住/, C.currentCity], [/通讯地址|联系地址|邮寄地址/, C.mailingAddress],
        [/期望.*(薪|工资|月薪|年薪)/, J.expectedSalary], [/调剂/, J.acceptAdjustment],
        [/应届|毕业生类型|是否往届/, P.graduateType], [/求职状态/, P.jobSearchStatus],
        [/准驾|驾照类型|车型/, I.driversLicenseType], [/驾照|驾驶/, I.driversLicense],
        [/语种/, L.type], [/(英语|外语).*(等级|水平|级别|证书)/, L.level], [/听说/, L.listening], [/读写/, L.reading],
        [/计算机|专业技能|技能特长|^技能/, S.primarySkills], [/兴趣|爱好|特长/, S.interests],
        [/最高学历/, E[0]?.degree], [/毕业院校|毕业学校/, E[0]?.school],
      ];
      v = (rules.find(([re, x]) => x && re.test(label)) || [])[1] ?? null;
    }
    if (v != null && String(v).trim()) out[f.key] = String(v);
  }
  return out;
}

// ---------- AI 认题：问题 → 资料项（只能从下面的清单里选，或答“没有”）----------
// AI 不编值：值永远由插件从资料取、写入后读回核对。认题结果存成“学到的规则”（AI 对应），同一平台同一题只问一次。
const CATALOG = {
  name: '姓名', gender: '性别', birthDate: '出生日期', phone: '手机号', email: '邮箱', nationality: '国籍', ethnicity: '民族',
  political: '政治面貌', marital: '婚姻状况', height: '身高', weight: '体重', health: '健康状况', graduateType: '应届/往届',
  idType: '证件类型', idNumber: '证件号码', license: '是否有驾照', licenseType: '驾照类型/准驾车型', hometown: '籍贯', hukou: '户口所在地',
  currentCity: '现居住地/所在城市', sourceLocation: '生源地', address: '通讯地址', emergencyName: '紧急联系人姓名', emergencyPhone: '紧急联系人电话',
  expectedSalary: '期望月薪', expectedSalaryAnnual: '期望年薪', acceptAdjustment: '是否接受调剂', skills: '技能/计算机能力', interests: '兴趣爱好',
  languageType: '外语语种', englishLevel: '英语等级', awards: '获奖情况', yearsOfWork: '工作年限', cityPref: '意向/期望工作城市',
  declareNo: '本人声明类是非题（犯罪记录、疾病、亲属在本公司、认识本公司员工、曾在本公司工作、退伍军人等），默认答“否”',
};
const LIST_CATALOG = {
  edu: { school: '学校', major: '专业', degree: '学历/学位', studyMode: '学习形式/培养方式', faculty: '院系', gpa: 'GPA/绩点', ranking: '成绩/专业排名', courses: '主修课程', start: '入学/开始时间', end: '毕业/结束时间' },
  intern: { company: '公司/单位', title: '职位', desc: '工作内容/职责', start: '开始时间', end: '结束时间', leaveReason: '离职原因' },
  work: { company: '公司/单位', title: '职位', desc: '工作内容/职责', start: '开始时间', end: '结束时间', leaveReason: '离职原因' },
  project: { name: '项目名称', role: '担任角色/职务', desc: '项目描述', start: '开始时间', end: '结束时间' },
  campus: { org: '组织/社团/实践名称', role: '职务', desc: '描述', start: '开始时间', end: '结束时间' },
  cert: { name: '证书名称', date: '获得时间', score: '分数' },
  family: { name: '姓名', relation: '与本人关系', company: '工作单位', title: '职务', phone: '联系电话' },
};
LIST_CATALOG.workOrIntern = LIST_CATALOG.work;
async function classify(fields) {
  const { settings = {} } = await store.get('settings');
  if (!settings.apiKey || Date.now() < aiDownUntil) return { map: {}, offline: true };
  // 经历/家庭成员块里的题只能对应这一块自己的属性：家庭成员的“出生年月”不能对到本人生日（2026-10 景瑞实测 AI 认错过）
  const choicesOf = f => f.list ? Object.entries(LIST_CATALOG[f.list] || {}).map(([k, v]) => [`${f.list}.${k}`, `本条的${v}`]) : Object.entries(CATALOG);
  const allowed = f => new Set(choicesOf(f).map(([k]) => k));
  const SYSTEM = `你是网申表单的“认题”助手：判断每个问题问的是不是候选人资料里的某一项。只做判断，不写答案。
规则：
1. 每个字段只能从它自己的 choices 里选一个键，或返回 null。
2. 必须是同一个意思才选；拿不准、意思更宽或更窄、需要推理才能对应的，返回 null。
3. 各公司自定的问题（面试站点、志愿、申请职位、从何途径得知、到岗时间、推荐人、现薪资、期望行业/职业等）资料里没有，返回 null。
4. “其他/另外/补充”开头的问题（其他计算机能力、其他外语、其他技能）是在主问题之外再要补充内容，返回 null。
5. section 是问题所在段落；choices 里带“列表.属性”的表示该段落某一条经历的属性。
只输出 JSON：{"map": {"字段key": "选中的键或 null"}}`;
  const items = fields.map(f => ({ key: f.key, section: f.section, question: f.label, kind: f.kind, options: (f.options || []).slice(0, 12),
    choices: Object.fromEntries(choicesOf(f)) }));
  try {
    const r = await chat(settings, SYSTEM, { fields: items }, 30000);
    const out = {};
    for (const f of fields) { const v = r?.map?.[f.key]; out[f.key] = typeof v === 'string' && allowed(f).has(v) ? v : null; }
    return { map: out };
  } catch (e) { return { map: {}, error: e.message, offline: !!e.offline }; }
}

async function pickOption(field, value, options) {
  // 从明确的 C1 资料选到界面的大类，不反向把仅有“C照”的资料猜成 C1。
  if (/驾照|驾驶|准驾|车型/.test(field.label || '') && /^c1(?:驾照|驾驶证)?$/.test(norm(value))) {
    const i = options.findIndex(o => /^(c照|小型汽车)$/.test(norm(o)));
    if (i >= 0) return i;
  }

  const { settings = {}, profile = {}, profileRev = 0, picks = {} } = await store.get(['settings', 'profile', 'profileRev', 'picks']);
  // 同样的问题 + 同样的选项，直接用上次 AI 选的那一项。
  const pk = [profileRev, norm(field.label), norm(value), norm(options.join('|')).slice(0, 300)].join('|');
  if (picks[pk] !== undefined) { const i = options.indexOf(picks[pk]); if (i >= 0 || picks[pk] === null) return i; }
  const remember = async i => {
    picks[pk] = i >= 0 ? options[i] : null;
    const keys = Object.keys(picks);
    if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete picks[k];
    await store.set({ picks });
    return i;
  };
  if (!settings.apiKey || Date.now() < aiDownUntil) return -1;
  try {
    const r = await chat(settings, '这是网申表单的一个下拉/单选题（可能是级联中的某一栏）。结合候选人资料，从 options 中选出最符合事实的一项：如果选项是上级分类（如“管理学”“工学”“内蒙古”），选包含 value 的那个上级分类；排名/区间选包含该值的最小区间（前10% → 前20%）；驾照“有” 对应车型时选 C 照类；省市名称可省略“省/市/自治区”后缀。都不合适才返回 -1。value 里注明“还需选择下一级”时：只有资料里明确写着这一级（如资料籍贯写了“赤峰市/红山区”）才选它；资料没有写到这一级就必须返回 -1，绝不能猜。只输出 JSON：{"index": 数字}',
      { question: `${field.section || ''} ${field.label}`, row: field.row, value, options: options.map((t, i) => ({ i, t })), profile: redact(profile).profile }, 20000);
    return remember(Number.isInteger(r.index) && r.index < options.length ? r.index : -1);
  } catch (_) { return -1; }
}

async function learn(items, page) {
  const { answers = {} } = await store.get('answers');
  let saved = 0;
  for (const item of items) {
    const f = scopeField(item, page);
    if (!f.value || /^(请选择|请输入|必填)/.test(f.value) || f.kind === 'file') continue;
    const k = answerKey(f);
    if (answers[k]?.value === f.value) continue;
    answers[k] = { label: f.label, section: f.section, row: f.row || 0, part: f.part || 0, kind: f.kind, value: f.value, host: page?.host, scope: AF.memory.needsScope(f.label) ? f.scope || null : null, updatedAt: Date.now() };
    saved++;
  }
  await store.set({ answers });
  return saved;
}

// ---------- 消息 ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  const handle = async () => {
    switch (msg.type) {
      // 开发用：只认本机开发页（tools/devserver.py）发来的重载，别的网站触发不了
      case 'DEV_RELOAD': {
        if (!/^http:\/\/127\.0\.0\.1:8765\//.test(sender.url || '')) return { ok: false };
        setTimeout(() => chrome.runtime.reload(), 150);
        return { ok: true, version: chrome.runtime.getManifest().version };
      }
      // 开发用：读/写存储（测试前快照、测试后还原用户真实数据）。同样只认本机开发页。
      case 'DEV_GET': if (!/^http:\/\/127\.0\.0\.1:8765\//.test(sender.url || '')) return {}; return store.get(msg.keys);
      case 'DEV_SET': if (!/^http:\/\/127\.0\.0\.1:8765\//.test(sender.url || '')) return {}; await store.set(msg.data); return { ok: true };
      case 'STATE': {
        await initializeDefaults();
        const { profile, settings = {}, memories = {}, files = {}, resume, photo, supplement = {} } = await store.get(['profile', 'settings', 'memories', 'files', 'resume', 'photo', 'supplement']);
        // 材料只发种类和文件名，内容按需用 GET_FILE 取。旧版单独存的简历、证件照也算进材料。
        const list = Object.entries(files).map(([id, f]) => ({ id, kind: f.kind, name: f.name }));
        if (resume?.base64 && !list.some(f => f.kind === '简历')) list.push({ id: 'legacy:resume', kind: '简历', name: resume.name });
        if (photo?.base64 && !list.some(f => f.kind === '证件照')) list.push({ id: 'legacy:photo', kind: '证件照', name: photo.name });
        return { profile: profile || {}, memories, files: list, autoExpand: settings.autoExpand !== false, supplement: Object.fromEntries(Object.entries(supplement).map(([k, v]) => [k, v.value])) };
      }
      case 'GET_FILE': {
        if (msg.id === 'legacy:resume') return (await store.get('resume')).resume || {};
        if (msg.id === 'legacy:photo') return (await store.get('photo')).photo || {};
        const { files = {} } = await store.get('files');
        return files[msg.id] || {};
      }
      case 'RESOLVE': return resolve(msg.fields, msg.page, msg.phase);
      case 'CLASSIFY': return classify(msg.fields || []);
      case 'PICK': return { index: await pickOption(msg.field, msg.value, msg.options) };
      case 'LEARN': return { saved: await learn(msg.items, msg.page) };
      // 诊断：只存字段元数据和失败原因（不含资料值），最多 500 条，导出给开发者补适配。
      case 'DIAG': {
        const { diag = [] } = await store.get('diag');
        const merged = [...diag, ...(msg.items || [])].slice(-500).map(AF.diag.sanitizeItem);
        await store.set({ diag: merged });
        return { saved: msg.items?.length || 0 };
      }
      // 学到的规则（core/memory.js 生成记录）：同一 id 只留一条，旧值进历史
      case 'MEM_SAVE': {
        const { memories = {} } = await store.get('memories');
        let next = memories;
        for (const m of msg.items || []) {
          const old = next[m.id];
          const history = old && old.to !== m.to ? [{ to: old.to, at: old.updatedAt, host: old.host }, ...(old.history || [])].slice(0, 5) : old?.history || [];
          next = { ...next, [m.id]: { ...m, history } };
        }
        await store.set({ memories: next });
        return { saved: msg.items?.length || 0 };
      }
      // 意向城市优先级：学到的新城市追加到末尾（不打乱你排好的顺序）。只改资料里的这一项，不清 AI 缓存。
      case 'CITY_ADD': {
        const { profile = {} } = await store.get('profile');
        const J = profile.jobPreferences ||= {};
        const cur = Array.isArray(J.cities) ? J.cities : String(J.cities || '').split(/[、,，\s/]+/).filter(Boolean);
        // 第一次学城市：现居城市原本就是默认首选，先放进去，学到的排在它后面
        const home = profile.contactAndLocation?.currentCity;
        if (!cur.length && home) cur.push(home);
        for (const c of msg.cities || []) if (c && !cur.some(x => norm(x).replace(/[省市]$/, '') === norm(c).replace(/[省市]$/, ''))) cur.push(c);
        J.cities = cur;
        await store.set({ profile });
        return { cities: cur };
      }
      // 资料补充：资料里空着、你在网页上填过的项（键 sem.xxx 或 列表.第几条.属性），所有网站通用
      case 'SUPPLEMENT_SAVE': {
        const { supplement = {} } = await store.get('supplement');
        for (const it of msg.items || []) supplement[it.key] = { value: it.value, label: it.label, host: it.host, updatedAt: Date.now() };
        await store.set({ supplement });
        return { saved: msg.items?.length || 0 };
      }
      case 'SUPPLEMENT_DELETE': { const { supplement = {} } = await store.get('supplement'); delete supplement[msg.key]; await store.set({ supplement }); return {}; }
      case 'MEM_DELETE': { const { memories = {} } = await store.get('memories'); delete memories[msg.id]; await store.set({ memories }); return {}; }
      case 'DIAG_EXPORT': { const { diag = [] } = await store.get('diag'); return { version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), items: diag.map(AF.diag.sanitizeItem) }; }
      case 'REMEMBERED': {
        const { answers = {} } = await store.get('answers');
        const values = {};
        for (const field of msg.fields) { const f = scopeField(field, msg.page); const a = rememberedAnswer(answers, f); if (a) values[f.key] = a.value; }
        return { values };
      }
      case 'RESUME': { const { resume } = await store.get('resume'); return resume || {}; }
      case 'PHOTO': { const { photo } = await store.get('photo'); return photo || {}; }
      case 'OPEN_OPTIONS': chrome.runtime.openOptionsPage(); return {};
      case 'RUN_FRAMES': {
        if (tabId == null || sender.frameId !== 0) return {};
        // 广播只收到某一帧的回调，不能据此认定所有 iframe 已完成；按浏览器提供的帧编号逐帧收集。
        const frames = await new Promise((ok, bad) => chrome.webNavigation.getAllFrames({ tabId }, list => {
          const e = chrome.runtime.lastError; e ? bad(e) : ok(list || []);
        }));
        const reports = await Promise.all(frames.filter(f => f.frameId !== 0).map(async f => {
          try {
            const r = await tabSend(tabId, { type: 'RUN', opts: msg.opts, runId: msg.runId }, { frameId: f.frameId });
            if (!Array.isArray(r?.results)) throw new Error('内嵌页面没有返回核验结果');
            return { frameId: f.frameId, results: r.results };
          } catch (_) {
            // 广告、统计、登录用的空 iframe 也会走到这里（飞书投递页有两个）：不出声，免得待处理里全是“内嵌页面”
            return { frameId: f.frameId, results: [] };
          }
        }));
        return { runId: msg.runId, reports };
      }
      case 'FRAME_FOCUS':
        if (tabId != null && sender.frameId === 0 && Number.isInteger(msg.frameId) && msg.frameId > 0)
          return tabSend(tabId, { type: 'FOCUS', key: msg.key }, { frameId: msg.frameId });
        return {};
      case 'CANCEL_FRAMES':
        if (tabId != null && sender.frameId === 0) tabSend(tabId, { type: 'CANCEL' }).catch(() => {});
        return {};
      case 'TEST_AI': {
        const { settings = {} } = await store.get('settings');
        const t = Date.now();
        aiDownUntil = 0;
        await chat({ ...settings, ...msg.settings }, '只输出 JSON：{"ok": true}', { ping: 1 }, 20000);
        return { ms: Date.now() - t };
      }
    }
    return {};
  };
  const task = MUTATIONS.has(msg.type) ? (mutationQueue = mutationQueue.catch(() => {}).then(handle)) : handle();
  task.then(reply, e => reply({ error: e.message || String(e) }));
  return true;
});

chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== 'fill') return;
  const tab = await activeTab();
  if (tab?.id != null) tabSend(tab.id, { type: 'RUN', fromCommand: true, opts: {} }).catch(() => {});
});
