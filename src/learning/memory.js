// 记忆（学到的规则）：纯函数，决定“一条手动修改记成什么、下次在哪里生效”。
//
// 两种记忆，都按“平台 + 字段身份”存，每个身份只留一条（新的覆盖旧的，旧值进历史）：
//   1. 换算：字段能对应资料（学历、学习形式、籍贯…），记“资料是 X 时，这里填 Y”。
//      资料改了（X 变成 Z）这条自然不再生效——不会拿旧答案顶掉新资料。
//   2. 固定回答：资料里没有的问题（住宿类型、第一志愿…），记“这里填 Y”。多条目块里的按第几条分开记。
// 字段身份：平台内置字段用字段 id（网站改了问题文字也认得）；各公司自建的问题 id 每家不同，用问题文字。
(() => {
  if (globalThis.AF?.memory) return;
  const AF = (globalThis.AF ||= {});
  const { norm } = AF.text;

  const needsScope = label => {
    const s = norm(label);
    return /本公司|我司|本企业|本集团|本岗位|应聘|申请职位|面试|招聘.*(?:渠道|来源)|(?:获知|得知|得悉).*招聘|内推|推荐码|志愿/.test(s);
  };
  function pageScope(page = {}) {
    let host = String(page.host || '').toLowerCase();
    let path = String(page.path || '');
    let search = String(page.search || '');
    if (page.url) {
      try { const url = new URL(page.url); host ||= url.hostname.toLowerCase(); path ||= url.pathname; search ||= url.search; } catch (_) {}
    }
    host = host.replace(/^https?:\/\//, '').split(/[/:?#]/)[0];
    if (/51job\.com$|job51/i.test(host)) {
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const ctmid = [...params.entries()].find(([k]) => k.toLowerCase() === 'ctmid')?.[1];
      if (ctmid) return `${host}:ctmid=${ctmid}`;
    }
    const tenant = path.match(/\/(SU[^/]+)/i)?.[1];
    if (tenant && (/hotjob\.cn$|hotjob/i.test(host) || /^SU/i.test(tenant))) return `${host}:${tenant.toLowerCase()}`;
    if (/mokahr\.com$|moka/i.test(host)) {
      const company = path.match(/\/(?:campus|social|intern|official|apply)(?:_apply)?\/([^/?#]+)/i)?.[1];
      if (company) return `${host}:${company.toLowerCase()}`;
    }
    return host;
  }
  const scopedIdent = (ident, f) => needsScope(f.label) && f.scope ? `${ident}@scope:${f.scope}` : ident;

  // 自定义字段：Moka 是数字 id，北森名字里带 _ext
  // 飞书公司自建题是“数字.数字”路径
  const custom = f => typeof f.id === 'number' || /^[\d.]+$/.test(String(f.id)) || /_ext/i.test(String(f.id)) || /^(cca|ccb|ccc|cce|ccf)\d+/i.test(String(f.id));
  // Only explicitly recognized section families share identities. Unknown sections
  // stay distinct by their normalized full name.
  const sectionClass = section => {
    const s = norm(section);
    if (/^(个人信息|基本信息|基础信息|联系信息|身份信息)$/.test(s)) return '个人';
    if (/^(教育经历|教育背景|学习经历|学历信息)$/.test(s)) return '教育';
    if (/^(实习经历|实习经验)$/.test(s)) return '实习';
    if (/^(工作经历|工作经验|职业经历|任职经历)$/.test(s)) return '工作';
    if (/^(项目经历|项目经验|科研经历)$/.test(s)) return '项目';
    if (/^(在校经历|校园经历|社团经历|社会实践|活动经历)$/.test(s)) return '校园';
    if (/^(证书|证书经历|资格证书)$/.test(s)) return '证书';
    if (/^(家庭成员|家庭信息|家属信息|紧急联系人)$/.test(s)) return '家庭';
    return s ? `section:${s}` : '';
  };
  const labelIdent = f => `label:${sectionClass(f.section)}/${norm(f.label)}`;
  const identOf = f => scopedIdent((custom(f) ? labelIdent(f) : `id:${f.id}/${sectionClass(f.section)}`) + (f.row ? `#${f.row}` : ''), f);
  // 换算记忆不分第几条（同一个资料值在哪一条都一样换算）
  const baseIdent = f => scopedIdent(custom(f) ? labelIdent(f) : `id:${f.id}/${sectionClass(f.section)}`, f);

  const LISTISH = /经历|经验|教育|学历|实习|工作|项目|证书|家庭|获奖|奖励|荣誉|语言|技能|论文|社团|校园|培训/;
  const idOf = m => [m.platform || '', m.ident, m.map != null ? 'map' : m.from != null ? 'from:' + norm(m.from) : 'answer'].join('|');
  const sameSection = (stored, f) => sectionClass(stored) === sectionClass(f.section);
  const legacyCustomIdent = m => `label:${m.section ? norm(m.section) + '/' : ''}${norm(m.label)}${m.from == null && m.map == null && m.row ? '#' + m.row : ''}`;
  const scopeMatches = (m, f) => !needsScope(f.label) || (!!f.scope && m.scope === f.scope);
  const legacyIdentityMatches = (m, f, ident) => scopeMatches(m, f) && (m.ident === ident || (custom(f) && m.ident === legacyCustomIdent(m) && sameSection(m.section, f)));

  // 填写时查：资料有值的查换算，资料没对应的查固定回答。返回记住的值或 null。
  function lookup(memories, platform, f, profileValue) {
    const list = Object.values(memories || {}).filter(m => scopeMatches(m, f));
    const row = f.row || 0;
    const compatibleSection = m => sectionClass(m.section) === sectionClass(f.section);
    const compatibleRow = m => (m.row || 0) === row;
    const candidates = (ident, type) => list.filter(m => m.platform === platform && m.ident === ident &&
      (type === 'map' ? m.map != null : m.from != null ? norm(m.from) === norm(profileValue) : m.from == null && m.map == null));
    const uniqueTo = hits => {
      const answers = new Set(hits.map(m => m.to));
      return answers.size === 1 ? hits[0]?.to ?? null : null;
    };
    if (profileValue != null && profileValue !== '' && typeof profileValue !== 'object') {
      const ident = baseIdent(f), k = idOf({ platform, ident, from: profileValue });
      const exact = list.find(m => idOf(m) === k && sameSection(m.section, f));
      if (exact) return exact.to;
      // Migration compatibility: old built-in identities omitted section. Require
      // both semantic section family and row to match before accepting one.
      const legacy = list.filter(m => m.platform === platform && legacyIdentityMatches(m, f, `id:${f.id}`) && m.from != null && norm(m.from) === norm(profileValue) && sameSection(m.section, f));
      if (!custom(f)) return uniqueTo(legacy);
      const customLegacy = list.filter(m => m.platform === platform && legacyIdentityMatches(m, f, ident) && m.from != null && norm(m.from) === norm(profileValue) && sameSection(m.section, f));
      if (customLegacy.length) return uniqueTo(customLegacy);
      return null;
    }
    if (profileValue === undefined || profileValue === null) {
      const k = idOf({ platform, ident: identOf(f) });
      const hit = list.find(m => idOf(m) === k && compatibleSection(m) && compatibleRow(m));
      if (hit) return hit.to;
      // Old built-in ids could collide across sections. Accept only a unique
      // answer whose stored section family and row match.
      if (!custom(f)) {
        const old = uniqueTo(list.filter(m => m.platform === platform && legacyIdentityMatches(m, f, `id:${f.id}`) && m.from == null && m.map == null && compatibleSection(m) && compatibleRow(m)));
        if (old != null) return old;
      }
      // Custom questions may cross platforms only when all matching answers agree.
      const ident = identOf(f);
      const crossSectionSeen = new Set(list.filter(m => m.from == null && !m.map && !m.row && norm(m.label) === norm(f.label) && !LISTISH.test(m.section || '') && !LISTISH.test(f.section || '')).map(m => m.to));
      if (sectionClass(f.section) === '个人' && crossSectionSeen.size > 1) return null;
      const same = ident.startsWith('label:') ? list.filter(m => (m.ident === ident || legacyIdentityMatches(m, f, ident) || (custom(f) && custom({ id: m.ident, label: m.label }) && norm(m.label) === norm(f.label) && sameSection(m.section, f))) && m.from == null && !m.map && compatibleRow(m) && compatibleSection(m)) : [];
      if (same.length) return uniqueTo(same);
      // 同一句话在别的网站的别的段落名下答过（“宗教信仰”在 Moka 的“个人信息”、北森的“基本信息”）：
      // 只用于不在经历块里的题，而且以前的回答都一致才用——答过两种说法就不猜。
      if (row || LISTISH.test(f.section || '')) return null;
      if (sectionClass(f.section) !== '个人') return null;
      const personalSeen = new Set(list.filter(m => m.from == null && !m.map && !m.row && norm(m.label) === norm(f.label) && !LISTISH.test(m.section || '') && sectionClass(m.section) === '个人').map(m => m.to));
      return crossSectionSeen.size === 1 && personalSeen.size === 1 ? [...personalSeen][0] : null;
    }
    return null;
  }

  // 一条手动修改 → 记忆记录（from 为空表示固定回答）
  function make(item, host) {
    const m = { platform: item.platform || null, ident: item.from != null ? baseIdent(item) : identOf(item), from: item.from ?? null,
      to: item.after, label: item.label, section: item.section || '', row: item.row || 0, host, scope: needsScope(item.label) ? item.scope || null : null, updatedAt: Date.now() };
    m.id = idOf(m);
    return m;
  }
  // 第三种记忆：问题 → 资料项的对应（AI 判断或人工指定），如“毕业年月 → edu.end”“现月薪 → 无”。
  // 只记“对应哪一项”，值永远从资料取，所以资料改了自动跟着变；map 为 'none' 表示这题资料里没有（公司自定），不再问 AI。
  const mapId = (platform, f) => [platform || '', baseIdent(f), 'map'].join('|');
  function lookupMap(memories, platform, f) {
    const values = Object.values(memories || {});
    const exactId = mapId(platform, f);
    const m = values.find(x => scopeMatches(x, f) && x.id === exactId && sameSection(x.section, f)) ||
      values.find(x => scopeMatches(x, f) && x.platform === platform && x.map != null && legacyIdentityMatches(x, f, `id:${f.id}`) && sameSection(x.section, f));
    if (!m) return undefined;
    if (m.map === 'none') return null;
    const [a, b] = m.map.split('.');
    return b ? { list: a, prop: b } : { sem: a };
  }
  const makeMap = (f, platform, map, by, host) => ({ id: mapId(platform, f), platform, ident: baseIdent(f), map: map || 'none', by,
    label: f.label, section: f.section || '', from: null, to: map || '（资料里没有，留给你填）', host, scope: needsScope(f.label) ? f.scope || null : null, updatedAt: Date.now() });

  // 存储（同一 id 只留一条、旧值进历史）在 background.js 的 MEM_SAVE。
  AF.memory = { identOf, baseIdent, idOf, lookup, make, lookupMap, makeMap, pageScope, needsScope };
})();
