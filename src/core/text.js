// 纯文本工具：归一、同义词、相似度、占位符判断。不碰 DOM，可在 node 里单测（core/、fallback/ 共用）。
(() => {
  if (globalThis.AF?.text) return;
  const AF = (globalThis.AF ||= {});

  const clean = s => String(s ?? '').replace(/[\s ]+/g, ' ').trim();
  const norm = s => clean(s).toLowerCase()
    .replace(/[\s*＊:：()（）[\]【】'"“”‘’,，.。、;；!！?？\/\\|_~—-]/g, '');

  // 同义词：选项匹配时把常见叫法归到同一个词。
  const SYNONYMS = [
    ['本科', '学士', '大学本科', 'bachelor', '本科学士'],
    ['硕士', '研究生', '硕士研究生', 'master', '硕士学位'],
    ['博士', '博士研究生', 'phd', 'doctor'],
    ['大专', '专科', '高职'],
    // 北森“学习形式”的写法（2026-10 明阳实测）：同一个意思在不同网站叫法差很多，遇到新叫法就加在这里。
    ['统招全日制', '全日制', '统招', '统招统分', 'fulltime', '全日制统招', '全国普通高等院校全日制', '普通高等院校全日制', '普通全日制', '全日制普通高等教育', '普通高等教育全日制',
      // “培养方式”问的是定向/非定向：统招全日制就是非定向（统招、并轨）
      '非定向', '非定向统招并轨', '非定向统招', '统招非定向', '非定向就业'],
    ['非全日制', '在职', 'parttime', '全国普通高等院校非全日制', '普通高等院校非全日制', '非全日制研究生'],
    ['男', 'male', '男性'],
    ['女', 'female', '女性'],
    ['是', 'yes', '有', '愿意', '接受', 'true', '同意'],
    ['否', 'no', '无', '不愿意', '不接受', 'false', '没有'],
    ['群众', '普通群众'],
    ['中共党员', '党员', '中国共产党党员'],
    ['共青团员', '团员', '中国共产主义青年团团员'],
    ['未婚', '单身'],
    ['已婚'],
    ['汉族', '汉'],
    ['身份证', '居民身份证', '中华人民共和国居民身份证', '二代身份证'],
    ['英语', '英文', 'english'],
    ['应届', '应届生', '应届毕业生'],
    ['中国', '中国大陆', '中华人民共和国', 'china'],
    ['六级', 'cet6', '英语六级', '大学英语六级', 'cet6级', '大学英语六级考试', '英语六级考试', '大学英语6级cet6', '大学英语6级', '英语6级'],
    ['四级', 'cet4', '英语四级', '大学英语四级', 'cet4级', '大学英语四级考试', '英语四级考试', '大学英语4级cet4', '大学英语4级', '英语4级'],
    ['专业八级', '专八', 'tem8', '英语专业八级', '大学生英语专业八级考试', '英语专业八级考试'],
    ['专业四级', '专四', 'tem4', '英语专业四级', '大学生英语专业四级考试', '英语专业四级考试'],
  ].map(group => group.map(norm));
  const canon = s => {
    const n = norm(s);
    for (const g of SYNONYMS) if (g.includes(n)) return g[0];
    return n;
  };

  function bigrams(s) {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  }
  // 0~1 的文本相似度：完全相同 > 同义词 > 包含 > 二元组重合。
  // 一边带否定（非/不/未/无）另一边不带：“全日制”和“全国普通高等院校非全日制”字面很像，意思相反。
  const NEG = /(^|[^a-z])(非|不|未|无)(?!锡|为)/;
  function sim(a, b) {
    const s = sim0(a, b);
    const x = norm(a), y = norm(b);
    // 同义词组里本来就是一对的（否/无、不愿意/否、未婚/单身）不压分。
    return x && y && x !== y && canon(x) !== canon(y) && NEG.test(x) !== NEG.test(y) ? Math.min(s, 0.3) : s;
  }
  function sim0(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (canon(x) === canon(y)) return 0.97;
    // 年/月/日下拉：“8”“08”“8月”“八月”是同一个；“2019”和“2019年”也是。
    const num = t => { const m = t.match(/^0*(\d{1,4})(年|月份?|日|号)?$/) || t.match(/^(十[一二]?|[一二三四五六七八九十])月份?$/); return m ? (/\d/.test(m[1]) ? +m[1] : ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'].indexOf(m[1]) + 1) : null; };
    const nx = num(x), ny = num(y);
    if (nx != null && ny != null) return nx === ny ? 0.96 : 0;
    // 去掉“相关/类/省/市/自治区”等后缀再比；带前缀的写法（内蒙古自治区-赤峰市）按结尾比。
    const strip = t => t.replace(/相关|专业|类$|特别行政区|自治区|省|市$/g, '');
    if (strip(x) && strip(x) === strip(y)) return 0.92;
    if (x.endsWith(y) || y.endsWith(x)) return 0.88;
    if (x.includes(y) || y.includes(x)) return 0.6 + 0.3 * Math.min(x.length, y.length) / Math.max(x.length, y.length);
    const A = bigrams(x), B = bigrams(y);
    let inter = 0;
    for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
    return 0.85 * 2 * inter / Math.max(1, x.length + y.length - 2);
  }
  // 排名档位：“前10%”在“前5% / 前20% / 前50%”里只能选前20%——选最紧、但仍然成立的那一档，绝不往好里报（2026-10-13 51job 实测选成了前5%）
  const RANK = /前\s*(\d+(?:\.\d+)?)\s*%/;
  function rankPick(target, items, getText) {
    const m = String(target ?? '').match(RANK);
    if (!m) return null;
    const ok = items.map(it => ({ it, y: +(String(getText(it)).match(RANK) || [])[1] })).filter(x => x.y >= +m[1]).sort((a, b) => a.y - b.y);
    return ok.length ? { item: ok[0].it, score: ok[0].y === +m[1] ? 1 : 0.9 } : null;
  }
  function best(target, items, getText = t => t) {
    const r = rankPick(target, items, getText);
    if (r) return r;
    let top = null, score = 0;
    for (const it of items) { const s = sim(target, getText(it)); if (s > score) { score = s; top = it; } }
    return { item: top, score };
  }

  const PLACEHOLDER = /^(请选择|请输入|请填写|请上传|select|please|choose|--|——|未选择|选择)/i;
  const isPlaceholder = v => !clean(v) || PLACEHOLDER.test(clean(v));

  AF.text = { clean, norm, canon, sim, best, isPlaceholder };
})();
