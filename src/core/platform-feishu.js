// 飞书招聘（*.jobs.feishu.cn）：字段路径、值格式来自 2026-10-13 多点 DMALL 真实投递页（test/cases/feishu/）。
// 系统自带字段的路径各公司一样（name、education[0].school、career[0].period……），按路径对应；
// 公司自建的题路径是数字 id（6932773077378484488[0].7694293915604437284），按“段落 + 问题文字”对应。
(() => {
  const AF = (globalThis.AF ||= {});
  (AF.platforms ||= {});
  if (AF.platforms.feishu) return;
  const { best, norm } = AF.text;
  const D = () => AF.convert;

  const GROUP = { education: 'edu', career: 'work', internship: 'intern', project: 'project', award: null, language: null, work: null };   // work 是“作品”，工作经历叫 career
  const ID = { name: { sem: 'name' }, mobile: { sem: 'phone' }, email: { sem: 'email' }, age: { sem: 'age' }, gender: { sem: 'gender' },
    preferredCityCodeList: { sem: 'cityPref' } };
  const PROP = { school: 'school', degree: 'degree', fieldOfStudy: 'major', field_of_study: 'major', education_type: 'studyMode', period: 'range',
    company: 'company', title: 'title', desc: 'desc', name: 'name', role: 'role' };
  const KIND = { text: 'text', textarea: 'textarea', select: 'select', multiselect: 'multi', period: 'range', city: 'region', mobile: 'phone', file: 'file' };

  const kind = f => KIND[f.type] || 'unknown';
  const listOf = f => GROUP[f.group] ?? null;
  function target(f) {
    if (ID[f.id]) return ID[f.id];
    const list = listOf(f), prop = f.id.split('.').pop();
    if (list && PROP[prop]) return { list, prop: list === 'project' && prop === 'title' ? 'role' : PROP[prop] };
    return AF.mapping.byLabel(f.label, list);
  }
  const options = f => {
    if (kind(f) === 'region') { const t = trees.get(f.key); return t ? t.nodes.map(n => ({ text: n.name, value: n.id })) : []; }
    return (f.options || []).map(o => ({ text: String(o.text), value: o.value }));
  };

  // 城市树（期望工作地点）：只留中国大陆这一支，省下面是市
  const trees = new Map();
  async function prepare(fields) {
    for (const f of fields) {
      if (kind(f) !== 'region' || trees.has(f.key)) continue;
      let nodes = await AF.rpc('tree', f.key).catch(() => []);
      // 城市表比表单晚到（页面刚出来时是空的）：等一会儿，最多 3 秒
      for (let i = 0; !nodes.length && i < 10; i++) { await new Promise(r => setTimeout(r, 300)); nodes = await AF.rpc('tree', f.key).catch(() => []); }
      if (!nodes.length) continue;   // 城市表还没加载出来：不缓存空表，下次再取（2026-10-15 飞书刚打开就点，期望工作地点报“找不到上海”）
      const cn = nodes.find(n => !n.parent && /中国/.test(n.name));
      const keep = new Set(cn ? [cn.id] : []);
      for (const n of nodes) if (keep.has(n.parent)) keep.add(n.id);   // 摊平时先父后子，一遍就够
      trees.set(f.key, AF.region.index(nodes.filter(n => n.id !== cn?.id && keep.has(n.id)).map(n => (n.parent === cn.id ? { ...n, parent: null } : n))));
    }
  }

  function encode(f, v, ctx = {}) {
    const k = kind(f), t = String(v);
    if (k === 'text' || k === 'textarea') return { raw: t };
    if (k === 'phone') {
      const tel = t.replace(/^\+?86[-\s]?/, '').replace(/\D/g, '');
      return tel ? { raw: { tel, code: f.raw?.code || 'CN_1' } } : { error: `“${v}”不是手机号` };
    }
    if (k === 'select') {
      const opts = options(f);
      let hit = best(t, opts, o => o.text);
      if (hit.score < 0.8 && D().yesNo(t) != null) { const want = D().yesNo(t) ? /^(是|有|愿意|接受|服从)/ : /^(否|无|不)/; const o = opts.find(x => want.test(x.text)); if (o) hit = { item: o, score: 0.9 }; }
      return hit.score >= 0.8 ? { raw: hit.item.value } : { pick: opts.map(o => o.text) };
    }
    if (k === 'multi') {
      const opts = options(f);
      // 选项本身可能包含顿号、逗号和斜线；先认完整选项，多项用分号分隔。
      const exact = opts.find(o => norm(o.text) === norm(t));
      const wants = Array.isArray(v) ? v : exact ? [exact.text] : t.split(/[;；\n]+/).map(x => x.trim()).filter(Boolean);
      const selected = wants.map(value => best(String(value), opts, o => o.text));
      if (!selected.length || selected.some(hit => hit.score < 0.8)) return { error: '多选答案中有网站字典无法对应的选项，请手动选择后记住' };
      return { raw: [...new Set(selected.map(hit => hit.item.value))] };
    }
    if (k === 'range') {
      const r = D().parseRange(v);
      if (!r) return { error: `无法识别起止时间“${typeof v === 'object' ? JSON.stringify(v) : v}”` };
      const s = d => (d ? `${d.y}-${String(d.m).padStart(2, '0')}` : '');
      if (r.now && !f.hasNow) {
        const today = D().parseDate(ctx.today || new Date().toISOString().slice(0, 10));
        return { raw: { start: s(r.start), end: s(today) }, note: '网页没有“至今”，结束时间已填本月' };
      }
      return { raw: { start: s(r.start), end: r.now ? '至今' : s(r.end) } };
    }
    if (k === 'region') {
      const tree = trees.get(f.key);
      if (!tree) return { error: '网页自己的城市列表是空的（下拉里也是“未找到”，网站没加载出来）：刷新页面后再点一键填写' };
      const hit = AF.region.resolve(tree, v);
      if (!hit) return { error: `城市表里找不到“${v}”` };
      // 选的是市：资料写到省（“上海”）时往下走到同名的市
      let node = tree.byId.get(hit.id);
      const kids = tree.kids(node.id);
      if (kids.length) { const same = kids.find(c => AF.region.same(c.name, node.name)) || (kids.length === 1 ? kids[0] : null); if (!same) return { error: `“${v}”是省份，请选具体城市` }; node = same; }
      return { raw: [node.id] };
    }
    return { error: '这类控件不自动填写' };
  }
  function decode(f, raw) {
    if (raw == null || raw === '') return '';
    const k = kind(f);
    if (k === 'select') { const o = options(f).find(x => String(x.value) === String(raw)); return o ? o.text : String(raw); }
    if (k === 'multi') return (Array.isArray(raw) ? raw : [raw]).map(value => options(f).find(o => String(o.value) === String(value))?.text || String(value)).join('；');
    if (k === 'range') return raw.start || raw.end ? `${raw.start || ''} ~ ${raw.end || ''}` : '';
    if (k === 'phone') return String(raw.tel || '');
    if (k === 'region') { const t = trees.get(f.key); return (Array.isArray(raw) ? raw : [raw]).map(id => (t && t.byId.get(id)?.name) || id).join('、'); }
    return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
  const same = (f, a, b) => {
    const k = kind(f);
    if (k === 'range') return D().sameYM(a?.start, b?.start) && (String(a?.end) === String(b?.end) || D().sameYM(a?.end, b?.end));
    if (k === 'region') return JSON.stringify(a || []) === JSON.stringify(b || []);
    if (k === 'multi') return Array.isArray(a) && Array.isArray(b) && JSON.stringify([...new Set(a.map(String))].sort()) === JSON.stringify([...new Set(b.map(String))].sort());
    if (k === 'phone') return String(a?.tel || '') === String(b?.tel || '');
    return norm(decode(f, a)) === norm(decode(f, b));
  };
  const section = f => f.groupTitle || '';
  const addArg = f => f.group;
  // 还没有条目的段落（引擎先点“添加”）：段落 key → 资料列表
  const listOfGroup = g => GROUP[g] ?? null;

  // 资料里这类经历一条都没有时勾段落自带的“没有 XX 经历”（应届生的工作经历）：资料列表 → 段落 key
  const markNone = list => ({ work: 'career' })[list] || null;

  AF.platforms.feishu = { name: '飞书招聘', kind, target, options, encode, decode, same, section, addArg, listOf, listOfGroup, prepare, markNone };
})();
