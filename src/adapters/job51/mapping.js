// 前程无忧 51job 校招“简历录入”（经典样式）：字段名 dlcolname 来自 2026-10-13 真实页（test/cases/job51/）。
// 一个字段可能是几个原生下拉拼起来的（省 + 市、年 + 月），写入值是“每个控件一项”：
// 下拉给按优先顺序排好的候选文字（第二级的选项要等第一级选完才出来，只能给候选，由页面侧逐个对），输入框给字符串。
(() => {
  const AF = (globalThis.AF ||= {});
  (AF.platforms ||= {});
  if (AF.platforms.job51) return;
  const { best, norm } = AF.text;
  const D = () => AF.convert;

  const COL = { Cname: { sem: 'name' }, Name: { sem: 'name' }, Gender: { sem: 'gender' }, Birthday: { sem: 'birthDate' }, BirthDay: { sem: 'birthDate' },
    Party: { sem: 'political' }, City: { sem: 'currentCity' }, TargetCity: { sem: 'cityPref' }, Email: { sem: 'email' }, MobilePhone: { sem: 'phone' },
    EnglishLevel: { sem: 'englishLevel' }, HuKou: { sem: 'hukou' }, Hukou: { sem: 'hukou' }, Nation: { sem: 'ethnicity' },
    Family: { sem: 'declareNo' }, WillingAssign: { sem: 'acceptAdjustment' } };
  const LABEL = { '第一志愿期望工作地': { sem: 'cityPref' }, '第二志愿期望工作地': { sem: 'cityPref' }, '第三志愿期望工作地': { sem: 'cityPref' },
    '通信地址': { sem: 'address' }, '紧急联系方式': { sem: 'emergencyPhone' },
    '所获奖励或荣誉情况': { sem: 'awards' }, '所获证书': { sem: 'certificatesText' }, '其他外语': { sem: 'none' } };
  const STEP_LIST = [[/教育/, 'edu'], [/实习|工作|社会实践/, 'workOrIntern'], [/项目/, 'project'], [/证书/, 'cert'], [/校园实践/, 'campus']];
  const listOf = f => (STEP_LIST.find(([re]) => re.test(f.groupTitle || '')) || [])[1] || null;
  const rowOf = f => {
    const suffix = String(f.label || '').match(/(\d+)$/);
    return suffix ? Math.max(0, +suffix[1] - 1) : (f.row || 0);
  };
  const labelBase = f => String(f.label || '').replace(/\d+$/, '');
  const isYM = f => /birth/i.test(f.id) || /出生|生日/.test(f.label);
  const isEduDate = f => f.editStyle === '3' || (/^(入学时间|毕业时间)$/.test(labelBase(f)) && /^(CCC\d*|GradDate)$/i.test(f.id));
  function kind(f) {
    const t = f.type;
    if (t === 'file') return 'file';
    if (t === 't' && isEduDate(f)) return 'date';
    if (t === 't') return 'text';
    if (t === 'a') return 'textarea';
    if (t === 's') return 'select';
    if ((t === 'ss' || t === 'sss') && isYM(f)) return 'ym';
    if ((t === 'ss' || t === 'sss') && /^(毕业学校|专业)$/.test(labelBase(f))) return 'cascade';
    if ((t === 'ss' || t === 'sss') && /city|area|hukou|native|地|籍贯|户口|生源/i.test(f.id + f.label)) return 'region';
    if (t === 'ss') return 'select2';   // 两级但不是地区：英语水平（等级 → 分数段）、其他外语（语种 → 程度）
    if (t === 'st' && /^(idcard|身份证|证件)/i.test(String(f.id) + String(f.label))) return 'identity';
    if (t === 'st' && /phone|mobile|手机|电话/i.test(f.id + f.label)) return 'phone';
    return 'unknown';
  }
  function target(f) {
    const list = listOf(f);
    if (!list && COL[f.id]) return COL[f.id];
    if (LABEL[labelBase(f)]) return LABEL[labelBase(f)];
    const label = labelBase(f);
    if (list === 'edu' && label === '学校类型') return { list, prop: 'schoolType', row: rowOf(f) };
    if (list === 'workOrIntern') {
      const props = { '工作单位': 'company', '社会实践内容描述': 'desc', '部门': 'department' };
      if (props[label]) return { list, prop: props[label] };
    }
    if (list === 'campus') {
      if (label === '校园实践内容描述') return { list, prop: 'desc' };
      if (label === '校园实践经历类型') return { list, prop: 'category' };
    }
    const t = AF.mapping.byLabel(label, list);
    return t?.list === 'edu' ? { ...t, row: rowOf(f) } : t;
  }
  const options = f => (f.options || []).map(o => ({ text: String(o.text), value: o.text }));

  function encode(f, v, ctx = {}) {
    const k = kind(f), t = String(v);
    if (k === 'date') {
      const current = D().NOW.test(t), d = D().parseDate(v) || (current ? D().parseDate(ctx.today || new Date().toISOString().slice(0, 10)) : null);
      return d ? { raw: [`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d || 1).padStart(2, '0')}`], ...(current ? { note: '网页日期框没有至今选项，已填今天' } : {}) } : { error: `无法识别日期“${v}”` };
    }
    if (k === 'text' || k === 'textarea') return { raw: [t] };
    if (k === 'identity') return { raw: [null, t] };
    if (k === 'cascade') {
      const label = labelBase(f);
      const entries = (f.options || []).flatMap(p => (p.children || []).map(c => ({ parent: p.text, child: c.text })));
      if (entries.length) {
        const base = s => norm(String(s).replace(/[（(][^）)]*[）)]$/, ''));
        const exact = entries.filter(x => norm(x.child) === norm(t));
        let matches = exact.length ? exact : entries.filter(x => base(x.child) === base(t));
        const edu = ctx.facts?.lists.edu[rowOf(f)];
        if (matches.length > 1 && edu) {
          for (const category of [edu.majorCategory, edu.discipline].filter(Boolean)) {
            const scoped = matches.filter(x => x.parent.includes(category) || x.child.includes(category));
            if (scoped.length === 1) { matches = scoped; break; }
          }
        }
        if (matches.length === 1) return { raw: [[matches[0].parent], [matches[0].child]] };
        const companion = (ctx.fields || []).find(x => x.label === (label === '专业' ? '其他专业' : '其他学校') + (rowOf(f) ? rowOf(f) + 1 : ''));
        const fallback = entries.filter(x => /其他/.test(x.child) && edu?.majorCategory && x.parent.includes(edu.majorCategory));
        if (!matches.length && companion && fallback.length === 1) return { raw: [[fallback[0].parent], [fallback[0].child]], additional: [{ key: companion.key, raw: [t], value: t }], note: '字典无同名项，已选其他并填写资料全称' };
        return { error: matches.length ? '字典里存在多个同名项，资料不足以区分' : '字典没有同名项，请填写其他学校或专业' };
      }
      if (label === '毕业学校') return { raw: [null, { search: t, parent: true }] };
      return { raw: [null, { search: t, parent: true }] };
    }
    if (k === 'select') {
      const opts = options(f);
      if (target(f)?.prop === 'nature' && t === '实习' && !opts.some(o => /实习/.test(o.text))) return { skip: '网站只提供兼职/全职，资料只有实习，无法确定工作类型' };
      if (/学校|专业/.test(labelBase(f))) {
        const exact = opts.filter(o => norm(o.text) === norm(t));
        const withoutDiscipline = s => norm(String(s).replace(/[（(][^）)]*[）)]$/, ''));
        const hits = exact.length ? exact : opts.filter(o => withoutDiscipline(o.text) === withoutDiscipline(t));
        return hits.length === 1 ? { raw: [[hits[0].text]] } : { error: `学校或专业字典中没有唯一的精确匹配“${v}”` };
      }
      let hit = best(t, opts, o => o.text);
      if (hit.score < 0.8 && D().yesNo(t) != null) { const want = D().yesNo(t) ? /^(是|有|愿意|接受|服从)/ : /^(否|无|不)/; const o = opts.find(x => want.test(x.text)); if (o) hit = { item: o, score: 0.9 }; }
      return hit.score >= 0.8 ? { raw: [[hit.item.text]] } : { pick: opts.map(o => o.text) };
    }
    if (k === 'phone') { const tel = t.replace(/^\+?86[-\s]?/, '').replace(/\D/g, ''); return tel ? { raw: [null, tel] } : { error: `“${v}”不是手机号` }; }
    if (k === 'select2') {
      const opts = options(f), hit = best(t, opts, o => o.text);
      if (hit.score < 0.8) return { pick: opts.map(o => o.text) };
      // 第二级是分数段时按资料里的分数挑（英语 525 → “CET6 425-550分”）；别的第二级留给你
      const score = /英语|english/i.test(f.id + f.label) ? +String(ctx.facts?.englishScore || '').replace(/[^\d.]/g, '') : 0;
      return { raw: [[hit.item.text], score ? [{ num: score }] : null] };
    }
    if (k === 'ym') {
      const d = D().parseDate(v) || (D().NOW.test(t) ? D().parseDate(ctx.today || new Date().toISOString().slice(0, 10)) : null);
      return d ? { raw: [[String(d.y)], [String(d.m).padStart(2, '0'), String(+d.m)]] } : { error: `无法识别日期“${v}”` };
    }
    if (k === 'region') {
      const hit = AF.region.resolve(AF.region.gb(), v);
      if (!hit) return { error: `地区表里找不到“${v}”` };
      // 每一级给几种写法：“上海市”“上海”；直辖市第二级就是它自己
      const p = hit.path, n = f.type.length;
      const alt = s => [...new Set([s, AF.region.core(s)])];
      const levels = [alt(p[0]), alt(p[1] || p[0])];
      if (n === 3) levels.push(p[2] ? alt(p[2]) : null);
      // 第一级必须在网页选项里（省份叫法不一的用相似度挑）
      // 网站把深圳等城市独立列在第一级；优先使用实际城市入口，
      // 否则选广东后第二级不会包含深圳。
      const cityFirst = p[1] && (f.options || []).find(o => alt(p[1]).some(w => AF.region.same(o.text, w)));
      const first = cityFirst || (f.options || []).find(o => levels[0].some(w => AF.region.same(o.text, w)));
      if (!first) return { error: `选项里没有“${p[0]}”` };
      levels[0] = [first.text];
      return { raw: levels };
    }
    return { error: '这类控件不自动填写' };
  }
  const first = x => (Array.isArray(x) ? (typeof x[0] === 'object' && x[0] ? '' : x[0] ?? '') : x ?? '');
  const decode = (f, raw) => (Array.isArray(raw) ? raw.map(first).filter(Boolean).join(kind(f) === 'ym' ? '-' : '/') : String(raw ?? ''));
  // a 是网页上的（每个控件的当前文字），b 是要写的（每个控件的候选）
  const rangeHas = (s, n) => {
    const t = String(s || '');
    let m = t.match(/(\d+(?:\.\d+)?)\D{0,3}[-~至](\d+(?:\.\d+)?)/); if (m) return n >= +m[1] && n <= +m[2];
    m = t.match(/(\d+(?:\.\d+)?)\D{0,2}以下/); if (m) return n < +m[1];
    m = t.match(/(\d+(?:\.\d+)?)\D{0,2}以上/); return !!m && n >= +m[1];
  };
  const same = (f, a, b) => Array.isArray(a) && Array.isArray(b) && b.every((want, i) => {
    if (want == null) return true;
    const cands = Array.isArray(want) ? want : [want];
    return cands.some(w => {
      if (w && typeof w === 'object') {
        if (Number.isFinite(+w.num)) return rangeHas(a[i], +w.num);
        if (typeof w.search === 'string') {
          const exact = s => {
            const v = String(s);
            return norm(/专业/.test(f.label || '') ? v.replace(/[（(][^）)]*[）)]$/, '') : v);
          };
          return exact(a[i]) === exact(w.search);
        }
        return false;
      }
      return norm(a[i]) === norm(w) || AF.region.same(a[i], w) || (kind(f) === 'ym' && +a[i] === +w);
    });
  });
  const section = f => f.groupTitle || '';
  const addArg = f => f.group;

  const companion = f => /^其他(学校|专业)\d*$/.test(f.label);
  AF.platforms.job51 = { name: '前程无忧经典分步', kind, target, options, encode, decode, same, section, addArg, listOf, companion, uploadTimeoutMs: 45000 };
})();
