// 前程无忧 51job 校招“简历展示页”（新样式，卡片 + 编辑器）：字段定义和值格式来自 2026-10-13 汉高投递页（test/cases/job51/）。
// 和经典录入页（platform-job51.js）同一个后台，系统字段名 colName 一样（这里是小写），对应表共用。
(() => {
  const AF = (globalThis.AF ||= {});
  (AF.platforms ||= {});
  if (AF.platforms.job51v) return;
  const { best, norm } = AF.text;
  const D = () => AF.convert;

  const COL = { cname: { sem: 'name' }, gender: { sem: 'gender' }, birthday: { sem: 'birthDate' }, party: { sem: 'political' },
    city: { sem: 'currentCity' }, targetcity: { sem: 'cityPref' }, email: { sem: 'email' }, mobilephone: { sem: 'phone' },
    englishlevel: { sem: 'englishLevel' }, hukou: { sem: 'hukou' }, nation: { sem: 'ethnicity' } };
  const MOD_LIST = [[/教育|学历/, 'edu'], [/实习|工作/, 'workOrIntern'], [/项目/, 'project'], [/证书/, 'cert'], [/校园|社团|学生干部/, 'campus'], [/论文|学术成果/, 'publication']];
  const listOf = f => (f.multi || MOD_LIST.some(([re]) => re.test(f.groupTitle || '')) ? (MOD_LIST.find(([re]) => re.test(f.groupTitle || '')) || [])[1] || null : null);
  // editStyle：1 单行、2/6 多行、4 下拉、18 可搜索的大字典下拉（学校、专业）、22 日期、7 附件、11 两级下拉
  const ES = { es1: 'text', es2: 'textarea', es6: 'textarea', es4: 'select', es18: 'select', es22: 'date', es7: 'file' };
  const kind = f => ES[f.type] || (f.type === 'es11' ? (/AREA|NATIONALITY|CITY/i.test(f.dict) || /地|籍/.test(f.label) ? 'region' : 'cascade') : 'unknown');
  // 有的公司把教育拆成几张卡：“最高学历”“教育经历2”“教育经历3”，分别是资料里第 1、2、3 条
  const cardRow = f => { const m = (f.groupTitle || '').match(/(\d)\s*$/); return m ? +m[1] - 1 : /最高学历/.test(f.groupTitle || '') ? 0 : null; };
  function target(f) {
    const list = listOf(f);
    const presence = /^是否有/.test(f.label) && list;
    if (presence) return { sem: 'has_' + list, perRow: true };
    if (!list && COL[f.id]) return COL[f.id];
    const label = list === 'edu' ? f.label.replace(/[2-9２-９]$/, '') : f.label;
    const extra = list === 'campus' ? { '贡献描述': 'desc', '职务类别': 'roleCategory', '类型': 'category' }
      : list === 'workOrIntern' ? { '时长': 'duration', '公司所在行业': 'industry', '公司规模': 'companySize', '岗位类别': 'jobCategory', '工作地点': 'workplaceType' }
      : list === 'publication' ? { '名称': 'name', '方向': 'category', '发布时间': 'date', '所属期刊': 'journal' }
      : list === 'cert' ? { '您获得过的证书及荣誉': 'name' } : {};
    const t = extra[label] ? { list, prop: extra[label] } : AF.mapping.byLabel(label, list);
    return t && t.list && cardRow(f) != null ? { ...t, row: cardRow(f) } : t;
  }
  const options = f => (f.options || []).map(o => ({ text: String(o.text), value: o.value }));
  const dictionaryName = value => norm(String(value).replace(/[（(][^（）()]*[）)]$/, ''));

  const trees = new Map();
  // 打开卡片与条件开关属于本平台生命周期，核心引擎仅调用这个接口。
  async function initialize(facts, opts) {
    const sections = await AF.rpc('sections');
    const requests = [];
    for (const s of sections) {
      const list = listOf({ groupTitle: s.title, multi: s.multi });
      const fixed = list === 'edu' ? cardRow({ groupTitle: s.title }) : null;
      const wanted = list ? (facts.lists[list] || []).length : 1;
      if (fixed != null && fixed >= wanted) continue;
      const desired = fixed != null ? 1 : wanted;
      if (!list || !s.multi) requests.push({ group: s.group, rows: [0] });
      else requests.push({ group: s.group, rows: Array.from({ length: s.count }, (_, i) => i), add: s.count < Math.max(1, desired) });
    }
    const opened = await AF.rpc('openSections', requests);
    // 写“是否有经历”会改变 isShow，必须等网站完成联动，再重新列出字段。
    const fields = await AF.rpc('list'), switches = [];
    for (const f of fields) {
      const t = target(f);
      if (!t?.sem?.startsWith('has_') || (f.raw != null && f.raw !== '' && !opts.overwrite)) continue;
      const enc = encode(f, facts[t.sem]);
      if ('raw' in enc) switches.push({ key: f.key, raw: enc.raw });
    }
    if (switches.length) await AF.rpc('writeMany', switches);
    const pending = opened.filter(x => !x.ok).map(x => ({ key: 'section:' + x.group, label: sections.find(s => s.group === x.group)?.title || '板块', state: 'fail', reason: x.error }));
    for (const s of sections) {
      const list = listOf({ groupTitle: s.title, multi: s.multi }), wanted = (facts.lists[list] || []).length;
      if (!s.multi || (list === 'edu' && cardRow({ groupTitle: s.title }) != null) || wanted <= Math.max(1, s.count + 1)) continue;
      pending.push({ key: 'more:' + s.group, label: s.title, section: s.title, state: 'nodata',
        reason: `资料有 ${wanted} 条，此板块添加时一次只能编辑一条；保存当前条目后再次填写会继续添加下一条` });
    }
    return pending;
  }
  async function prepare(fields) {
    for (const f of fields) {
      if (kind(f) !== 'region' || trees.has(f.dict)) continue;
      const nodes = await AF.rpc('tree', f.key).catch(() => []);
      if (nodes.length) trees.set(f.dict, AF.region.index(nodes));   // 空表不缓存
    }
  }

  function encode(f, v, ctx = {}) {
    const k = kind(f), t = String(v);
    if (k === 'text' || k === 'textarea') return { raw: t };
    if (k === 'select') {
      const opts = options(f);
      // 学校/专业大字典只能选同名条目，不能把相近专业当作真实专业。
      if (f.type === 'es18') {
        const matches = opts.filter(o => dictionaryName(o.text) === dictionaryName(t));
        const tgt = target(f), education = tgt?.list === 'edu' ? ctx.facts?.lists.edu[tgt.row ?? f.row] : null;
        const scoped = education?.discipline ? matches.filter(o => o.text.includes(education.discipline)) : [];
        const exact = opts.find(o => norm(o.text) === norm(t)) || (matches.length === 1 ? matches[0] : scoped.length === 1 ? scoped[0] : null);
        return exact ? { raw: exact.value } : { error: '学校或专业字典中没有同名条目，请使用网页的其他项填写全称' };
      }
      if (target(f)?.prop === 'duration' && /^\d+个月$/.test(t)) {
        const months = +t.replace(/个月$/, '');
        const exact = opts.find(o => { const m = o.text.match(/^(\d+)-(\d+)个月$/); return m ? months >= +m[1] && months <= +m[2] : /^(\d+)个月以上$/.test(o.text) && months >= parseInt(o.text, 10); });
        return exact ? { raw: exact.value } : { error: '经历时长不在网站提供的档位中' };
      }
      let hit = best(t, opts, o => o.text);
      if (hit.score < 0.8 && D().yesNo(t) != null) { const want = D().yesNo(t) ? /^(是|有|愿意|接受|服从)/ : /^(否|无|不)/; const o = opts.find(x => want.test(x.text)); if (o) hit = { item: o, score: 0.9 }; }
      return hit.score >= 0.8 ? { raw: hit.item.value } : { pick: opts.map(o => o.text) };
    }
    if (k === 'cascade') {
      if (!/ENGLISHLEVEL/i.test(f.dict)) return { error: '资料中没有该外语及其等级，请单独填写' };
      const opts = f.options || [], hit = best(t, opts, o => o.text);
      if (hit.score < 0.8) return { error: '英语等级不在网站字典中' };
      const score = Number(ctx.facts?.englishScore), children = hit.item.children || [];
      const child = children.find(o => {
        const label = o.text.replace(/^(CET|TEM)\d\s*/i, '');
        let m = label.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)/);
        if (m) return score >= +m[1] && score <= +m[2];
        m = label.match(/(\d+(?:\.\d+)?)分?以下/); if (m) return score < +m[1];
        m = label.match(/(\d+(?:\.\d+)?)分?以上/); return m && score >= +m[1];
      });
      return Number.isFinite(score) && score > 0 && child ? { raw: child.value } : { error: '英语等级已知，但无法确定网站要求的成绩档位' };
    }
    if (k === 'date') {
      let d = D().parseDate(v), note;
      // “至今”：这个日期框没有至今选项（2026-10-13 实习/工作经验“结束时间”报“无法识别日期至今”），填今天
      if (!d && D().NOW.test(t)) { d = D().parseDate(ctx.today || new Date().toISOString().slice(0, 10)); note = '网页没有“至今”，已填今天'; }
      return d ? { raw: `${D().format(d, 'yyyy-MM-dd')} 00:00:00`, note } : { error: `无法识别日期“${v}”` };
    }
    if (k === 'region') {
      const tree = trees.get(f.dict);
      if (!tree) return { error: '没取到网页的地区表' };
      const hit = AF.region.resolve(tree, v);
      if (!hit) return { error: `地区表里找不到“${v}”` };
      // 存的是第二级（市）：写到区县的往上收到市；只写了省的，省下只有一个同名市（上海）就用它
      let node = tree.byId.get(hit.id);
      while (node?.parent && tree.byId.get(node.parent)?.parent) node = tree.byId.get(node.parent);
      if (!node.parent) {
        const kids = tree.kids(node.id), same = kids.find(c => AF.region.same(c.name, node.name)) || (kids.length === 1 ? kids[0] : null);
        if (!same) return { error: `“${v}”只到省，请选具体城市` };
        node = same;
      }
      return { raw: node.id };
    }
    return { error: '这类控件不自动填写' };
  }
  function decode(f, raw) {
    if (raw == null || raw === '') return '';
    const k = kind(f);
    if (k === 'select') { const o = options(f).find(x => String(x.value) === String(raw)); return o ? o.text : String(raw); }
    if (k === 'cascade') {
      for (const p of f.options || []) { const child = (p.children || []).find(c => String(c.value) === String(raw)); if (child) return `${p.text}/${child.text}`; }
      return String(raw);
    }
    if (k === 'date') return String(raw).slice(0, 10);
    if (k === 'region') { const t = trees.get(f.dict); return (t && AF.region.nameOf(t, raw)) || String(raw); }
    return String(raw);
  }
  const same = (f, a, b) => f.uiMatchesRaw !== false && (kind(f) === 'date' ? String(a || '').slice(0, 10) === String(b || '').slice(0, 10) : String(a ?? '') === String(b ?? '') || norm(decode(f, a)) === norm(decode(f, b)));
  const section = f => f.groupTitle || '';
  const addArg = f => f.group;

  AF.platforms.job51v = { name: '前程无忧卡片简历', kind, target, options, encode, decode, same, section, addArg, listOf, prepare, initialize };
})();
