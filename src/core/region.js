// 地区：把资料里的“内蒙古自治区/赤峰市/红山区”“上海”换成平台的地区编号。
// 平台各有各的编号表（Moka 用国标六位码，北森用自家 id），但都是“id、名称、上级”的树，用同一套匹配。
(() => {
  if (globalThis.AF?.region) return;
  const AF = (globalThis.AF ||= {});

  // 省市区名称比对：去掉“省/市/自治区/壮族…”等后缀后相同就算同一个地方。
  const SUFFIX = /(维吾尔|壮族|回族)?(特别行政区|自治区|自治州|自治县|地区|新区|盟|省|市|区|县|旗)$/;
  const core = n => String(n || '').trim().replace(/\s+/g, '').replace(SUFFIX, '');
  const same = (a, b) => a && b && (a === b || core(a) === core(b));

  // 国标码表 → 树节点。直辖市没有“市”这一级（310100 不存在），区县直接挂到省。
  let gbTree = null;
  function gb() {
    if (gbTree) return gbTree;
    const t = AF.regionsGB || {};
    const nodes = Object.entries(t).map(([id, name]) => {
      let parent = null;
      if (!id.endsWith('0000')) {
        const city = id.slice(0, 4) + '00', prov = id.slice(0, 2) + '0000';
        parent = id.endsWith('00') ? prov : (t[city] ? city : prov);
      }
      return { id, name, parent };
    });
    return (gbTree = index(nodes));
  }
  // 北森 Areas-chs-*.js：ConstAreas([[id, [名称], 上级id, ...], ...])
  function beisen(text) {
    const arr = JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')));
    return index(arr.map(x => ({ id: String(x[0]), name: x[1][0], parent: x[2] ? String(x[2]) : null }))
      .filter(n => n.name !== '全国' && n.name !== '国外'));
  }
  function index(nodes) {
    const kids = new Map();
    for (const n of nodes) { const k = n.parent || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); }
    const byId = new Map(nodes.map(n => [n.id, n]));
    // 顶层：没有上级，或上级不在表里（北森的省挂在“全国”下）。
    const roots = nodes.filter(n => !n.parent || !byId.has(n.parent));
    return { nodes, byId, roots, kids: id => kids.get(id) || [] };
  }

  // 返回最深的匹配节点 { id, name, path:[名称…], depth, matched }；一级都对不上返回 null。
  // 资料层级可以比平台多（平台只到市就停在市），也可以少（只写了“上海”就停在省）。
  function resolve(tree, text) {
    const segs = String(text || '').split(/[\/／>,，\s-]+/).map(x => x.trim()).filter(Boolean);
    if (!segs.length) return null;
    let level = tree.roots, hit = null, path = [], i = 0;
    for (; i < segs.length && level.length; i++) {
      let n = level.find(x => same(x.name, segs[i]));
      // 直辖市写法“上海市/上海市/黄浦区”：第二段和上一段同名时跳过。
      if (!n && hit && same(hit.name, segs[i])) continue;
      if (!n) break;
      hit = n; path.push(n.name); level = tree.kids(n.id);
    }
    if (!hit) {
      // 只写了区县或城市（“黄浦区”“杭州”）：全表找唯一同名的那个。
      const all = tree.nodes.filter(x => same(x.name, segs[segs.length - 1]));
      if (all.length !== 1) return null;
      hit = all[0];
      path = [];
      for (let n = hit; n; n = n.parent ? tree.byId.get(n.parent) : null) path.unshift(n.name);
    }
    return { id: hit.id, name: hit.name, path, depth: path.length, matched: i };
  }
  // 编号 → “省/市/区”文字（回读、学习时把编号翻回人能看的写法）。
  function nameOf(tree, id) {
    const out = [];
    for (let n = tree.byId.get(String(id)); n; n = n.parent ? tree.byId.get(n.parent) : null) out.unshift(n.name);
    return out.join('/');
  }

  AF.region = { gb, beisen, index, resolve, nameOf, same, core };
})();
