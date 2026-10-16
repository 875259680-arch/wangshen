// Hotjob（wecruit.hotjob.cn 及挂在公司域名下的同款系统）：字段、值格式来自 2026-10-13 真实简历页（test/cases/hotjob/）。
// 字段按 fillType 分控件：1 文字（学校/专业是字典搜索）、2 日期、3 单选、4 下拉、6 多行文字、8 上传、
// 9 层级选择（地区、期望职能；学校/专业也走 9 时是弹窗字典）、15 地区树；5、10 是多选树，不自动填。
// 各公司模板的字段键不同（段落号_字段号），问法基本是系统自带的，所以按“段落 + 问题文字”对应，不维护 id 表。
(() => {
  const AF = (globalThis.AF ||= {});
  (AF.platforms ||= {});
  if (AF.platforms.hotjob) return;
  const { best, norm, sim } = AF.text;
  const D = () => AF.convert;

  const ft = f => +String(f.type).slice(2);
  const isDict = f => f.dict === 'school' || f.dict === 'subject';
  function kind(f) {
    const t = ft(f);
    if (isDict(f) && (t === 1 || t === 9)) return 'dict';
    if (t === 1) return 'text';
    if (t === 2) return 'date';
    if (t === 3 || t === 4) return f.ds === '0/4' ? 'unknown' : 'select';   // 4 + 0/4 存的是 JSON，没见过实例，先不碰
    if (t === 6) return 'textarea';
    if (t === 8) return 'file';
    if (t === 9 || t === 15) return f.ds === '0/4' ? 'region' : 'tree';
    return 'unknown';
  }

  // 段落名 → 资料列表（null = 单值段落）
  const SECTION_LIST = [[/教育/, 'edu'], [/实习/, 'intern'], [/工作经历|工作经验/, 'work'], [/项目/, 'project'], [/证书|资格/, 'cert'],
    [/家庭/, 'family'], [/校内|在校|社团|学生干部|社会实践|校园/, 'campus']];
  const listOf = f => (SECTION_LIST.find(([re]) => re.test(f.groupTitle || '')) || [])[1] || null;
  // 系统自带、但通用规则表里没有的问法
  const LABEL = [[/^英语证书名称$/, { sem: 'englishLevel' }], [/^国籍\/地区$/, { sem: 'nationality' }], [/^期望职能$/, null]];
  function target(f) {
    const list = listOf(f);
    if (!list) {
      const t = AF.mapping.clean(f.label);
      const hit = LABEL.find(([re]) => re.test(t));
      if (hit) return hit[1];
      // “英语能力”段落里的“成绩”是英语成绩，不是证书分数
      if (/英语/.test(f.groupTitle) && /^(成绩|分数)$/.test(t)) return { sem: 'englishScore' };
    }
    return AF.mapping.byLabel(f.label, list);
  }
  const options = f => (f.options || []).map(o => ({ text: String(o.text), value: o.value }));

  // 字典树按 ds 缓存（同一个地区表几十个字段共用）：{ index: 地区树, nodes }
  const trees = new Map();
  async function prepare(fields) {
    for (const f of fields) {
      const k = kind(f);
      if ((k !== 'region' && k !== 'tree') || !f.hasTree || trees.has(f.ds)) continue;
      const nodes = await AF.rpc('tree', f.key).catch(() => []);
      if (!nodes.length) continue;   // 还没加载出来的不缓存空表
      // 地区树的“其它”“其他国家/地区”不参与按名字找（“其它”会和任何对不上的写法撞上）
      trees.set(f.ds, AF.region.index(nodes.filter(n => !/^其[它他]/.test(n.name))));
    }
  }
  // 学校、专业：按资料里的写法去网站字典搜，结果给 encode 挑。网站的名字后面带门类（“物流工程与管理(管理学类专业学位)”），
  // 搜索词去掉括号说明再搜（记住的回答可能就是带括号的全名）。
  const dictCache = new Map();
  async function lookup(f, value) {
    if (kind(f) !== 'dict') return;
    const q = String(value).replace(/[（(].*?[)）]$/, '').trim();
    const k = `${f.dict}|${f.key}|${q}`;
    if (!dictCache.has(k)) dictCache.set(k, AF.rpc('search', f.key, q).catch(() => []));
    f.dictOptions = await dictCache.get(k);
  }
  const base = t => String(t || '').replace(/[（(][^（()）]*[)）]$/, '');

  // 层级编码：地区写到“市”一级（网站的级联框存的就是市；直辖市往下走一层到“上海市”）
  function regionCode(f, v) {
    const tree = trees.get(f.ds);
    if (!tree) return { error: '没取到网站的地区表' };
    const hit = AF.region.resolve(tree, v);
    if (!hit) return { error: `地区表里找不到“${v}”` };
    let node = tree.byId.get(hit.id);
    while (hit.depth > 2 && node.parent && tree.byId.get(node.parent)?.parent) { node = tree.byId.get(node.parent); hit.depth--; }
    if (hit.depth === 1) { const kids = tree.kids(node.id); if (kids.length === 1) node = kids[0]; }
    return { raw: node.id };
  }

  function encode(f, v, ctx = {}) {
    const k = kind(f), t = String(v);
    if (k === 'text' || k === 'textarea') return { raw: t };
    if (k === 'date') {
      const d = D().parseDate(v);
      if (!d && D().NOW.test(t)) {
        if (f.allowNow) return { raw: '1000-01-01' };
        const today = D().parseDate(ctx.today || new Date().toISOString().slice(0, 10));
        return { raw: D().format(today, 'yyyy-MM-dd'), note: '网页没有“至今”，已填今天' };
      }
      return d ? { raw: D().format(d, 'yyyy-MM-dd') } : { error: `无法识别日期“${v}”` };
    }
    if (k === 'select') {
      const opts = options(f);
      let hit = best(t, opts, o => o.text);
      if (hit.score < 0.8 && D().yesNo(t) != null) { const want = D().yesNo(t) ? /^(是|有|愿意|接受|服从)/ : /^(否|无|不)/; const o = opts.find(x => want.test(x.text)); if (o) hit = { item: o, score: 0.9 }; }
      return hit.score >= 0.8 ? { raw: hit.item.value } : { pick: opts.map(o => o.text) };
    }
    if (k === 'region') return regionCode(f, v);
    if (k === 'tree') {
      const tree = trees.get(f.ds);
      if (!tree) return { error: '没取到网站的选项表' };
      const path = tree.nodes.find(n => AF.region.nameOf(tree, n.id) === t);
      if (path) return { raw: path.id };
      const hit = best(t, tree.nodes, n => n.name);
      return hit.score >= 0.8 ? { raw: hit.item.id } : { pick: tree.nodes.map(n => AF.region.nameOf(tree, n.id)) };
    }
    if (k === 'dict') {
      const opts = f.dictOptions || [];
      if (!opts.length) return { error: `网站的${f.dict === 'school' ? '学校' : '专业'}库里搜不到“${t}”` };
      // 先比去掉门类括号的名字（“物流工程与管理” = “物流工程与管理(管理学类专业学位)”），再比全名
      const exact = opts.find(o => norm(o.text) === norm(t)) || opts.find(o => norm(base(o.text)) === norm(base(t)));
      if (exact) return { raw: { code: exact.value, name: exact.text } };
      const hit = best(base(t), opts, o => base(o.text));
      if (hit.score >= 0.92) return { raw: { code: hit.item.value, name: hit.item.text } };
      return { pick: opts.map(o => o.text) };
    }
    return { error: '这类控件不自动填写' };
  }
  // PICK 回来的是选项文字：层级选项（“省/市”）和字典选项要换回原始值
  function options2(f) {
    const k = kind(f);
    if (k === 'tree') { const tree = trees.get(f.ds); return tree ? tree.nodes.map(n => ({ text: AF.region.nameOf(tree, n.id), value: n.id })) : []; }
    if (k === 'dict') return (f.dictOptions || []).map(o => ({ text: o.text, value: o.value }));
    return options(f);
  }

  function decode(f, raw) {
    if (raw == null || raw === '') return '';
    const k = kind(f);
    if (k === 'dict') return typeof raw === 'object' ? String(raw.name || raw.code || '') : String(raw);
    if (k === 'date') return raw === '1000-01-01' ? '至今' : String(raw);
    if (k === 'select') { const o = options(f).find(x => String(x.value) === String(raw)); return o ? o.text : String(raw); }
    if (k === 'region' || k === 'tree') { const tree = trees.get(f.ds); return (tree && AF.region.nameOf(tree, raw)) || String(raw); }
    return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
  const same = (f, a, b) => {
    const k = kind(f);
    if (k === 'dict') return !!a && !!b && (a.code === b.code || norm(a.name) === norm(b.name));
    if (k === 'select' || k === 'region' || k === 'tree' || k === 'date') return String(a ?? '') === String(b ?? '');
    return norm(decode(f, a)) === norm(decode(f, b));
  };
  const section = f => f.groupTitle || '';
  const addArg = f => f.group;

  // parseSaves：顶部“上传文件简历”解析后网站立刻保存，引擎不自动上传（engine.js resumeFirst）
  AF.platforms.hotjob = { name: 'Hotjob', parseSaves: true, kind, target, options: options2, encode, decode, same, section, addArg, listOf, prepare, lookup };
})();
