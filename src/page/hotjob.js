// Hotjob（wecruit.hotjob.cn，也有挂在公司自己域名下的，如 zhaopin.changhong.com）页面侧。
// 表单是 React + antd：每个“段落”组件（个人基本信息、教育经历……）在自己的 state.data 里按字段键存值，
// 字段组件拿到的 handleChange(字段键, 值[, 选中项]) 就是段落自己的写入口——用户在界面上选完也是走它。
// 值的格式（2026-10-13 真实简历页）：文字是字符串；下拉/单选是字典编码 "0/599/604"；地区和职能是层级编码 "0/4/10/11"；
// 日期是 "YYYY-MM-DD"，“至今”存 "1000-01-01"；学校、专业是 {code, name}，只能从网站字典里选（远程搜索）。
// 这里只列原始数据、写原始值、查网站字典；对应关系和值格式在 core/platform-hotjob.js。
(() => {
  const P = window.__afPage;
  if (!P) return;
  const fiberOf = el => { const k = el && Object.keys(el).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const anchor = () => document.querySelector('.resume-content-wrap');

  function rootFiber() { let f = fiberOf(anchor()); while (f && f.return) f = f.return; return f; }
  // 字段组件：props 里有 item（字段定义）、itemId（值的键）和 handleChange。找到后不再往里走（里面是 antd 的输入框）。
  function comps() {
    const out = [], st = [rootFiber()];
    while (st.length) {
      const fb = st.pop(); if (!fb) continue;
      const p = fb.memoizedProps;
      if (p && p.item && p.item.fillType && typeof p.itemId === 'string' && typeof p.handleChange === 'function') { out.push(fb); st.push(fb.sibling); continue; }
      st.push(fb.sibling, fb.child);
    }
    return out;
  }
  const sectionOf = fb => { for (let b = fb.return; b; b = b.return) { const p = b.memoizedProps; if (p && p.infoData && p.handleFieldChange) return b; } return null; };
  const hostOf = fb => { const st = [fb.child]; while (st.length) { const x = st.shift(); if (!x) continue; if (x.stateNode instanceof Element) return x.stateNode; st.push(x.child, x.sibling); } return null; };
  const boxOf = fb => { const h = hostOf(fb); return h?.closest('.ant-form-item') || h; };
  // 字典树（地区、职能）：网站给的是 {code, name, sonDicInfos}，antd 树是 {value, title, children}，统一摊平成 {id, name, parent}
  function flat(tree) {
    const out = [], st = (tree || []).map(n => [n, null]);
    while (st.length) {
      const [n, parent] = st.shift();
      const id = String(n.code ?? n.value ?? ''), name = String(n.name ?? n.title ?? n.nameCh ?? '');
      if (!id) continue;
      out.push({ id, name, parent });
      for (const c of n.sonDicInfos || n.children || []) st.push([c, id]);
    }
    return out;
  }

  function describe(fb) {
    const p = fb.memoizedProps, it = p.item, sec = sectionOf(fb), sp = sec?.memoizedProps || {};
    // 段落的 isMutiRecord 为真时反而是单条（个人基本信息），多条目的字段键带 _第几条（从 1 开始）
    const multi = !sp.isMutiRecord, m = p.itemId.match(/_(\d+)$/);
    const row = multi && m && p.itemId !== it.itemId ? +m[1] - 1 : 0;
    const map = p.dataSourceMap || {};
    const tree = it.fillType === 9 ? p.dataSource : [5, 10, 15].includes(it.fillType) ? p.treeData : null;
    const f = { key: p.itemId, id: String(it.itemId), group: String(sp.id ?? ''), groupTitle: sp.name || '', multi, row,
      type: 'ft' + it.fillType, ds: it.dataSource || '', dict: it.customDataSource || '', label: it.name || it.cnName || '',
      required: !it.isNeed, allowNow: !!it.isSoFar,
      options: Object.entries(map).map(([value, text]) => ({ text: String(text), value })),
      hasTree: Array.isArray(tree) && tree.length > 0,
      raw: p.value === undefined ? null : p.value };
    if (it.fillType === 8) f.hint = (boxOf(fb)?.innerText || '').replace(/\s+/g, ' ').slice(0, 160);
    return f;
  }
  const byKey = () => new Map(comps().map(fb => [fb.memoizedProps.itemId, fb]));

  // 写一个字段。学校/专业要连同选中项一起给（段落据此存成 {code, name}）。
  // 段落把成对日期（开始/结束）、学校、专业的改动交给整张表时，走的是全页共用的 300ms 防抖：
  // 连着写几个，只有最后一个到得了整张表，其余的在下次渲染时被整张表的旧值刷成空（2026-10-13 实测：面板显示已填，过一会儿变空）。
  // 所以段落收下以后，我们自己把值直接交给整张表（就是防抖最后会调的那个函数）。
  function writeFb(fb, raw) {
    const p = fb.memoizedProps;
    if (raw && typeof raw === 'object' && raw.code) {
      p.handleChange(p.itemId, raw.code, [{ value: raw.code, text: raw.name, type: p.item.customDataSource === 'school' ? 'school' : undefined }]);
    } else p.handleChange(p.itemId, raw);
    const sec = sectionOf(fb), v = sec?.stateNode?.state?.data?.[p.itemId];
    if (sec && eq(v, raw) && typeof sec.memoizedProps.handleFieldChange === 'function') sec.memoizedProps.handleFieldChange(p.itemId, v);
  }
  // 段落写值是同步改 state.data 再 setState；日期早于开始时间会被网站拒掉、弹提示
  const stored = fb => { const s = sectionOf(fb)?.stateNode?.state?.data; return s ? s[fb.memoizedProps.itemId] : undefined; };
  // 段落里存下了、组件也拿到了才算收下（只看一处会被“写进去又被刷回去”骗过）
  const eq = (v, raw) => (raw && typeof raw === 'object' ? v?.code === raw.code : String(v ?? '') === String(raw ?? ''));
  const took = (fb, raw) => eq(stored(fb), raw) && eq(fb.memoizedProps.value, raw);

  P.register({
    id: 'hotjob',
    detect: () => !!fiberOf(anchor()) && comps().length > 0,
    list: () => comps().map(describe),
    // 字段自带的字典树（地区、期望职能）摊平返回；引擎按 ds 缓存，不随每次 list 传
    tree(key) { const fb = byKey().get(key); if (!fb) return []; const p = fb.memoizedProps; return flat(p.item.fillType === 9 ? p.dataSource : p.treeData); },
    // 学校、专业：查网站自己的字典（和输入框里打字搜索是同一个接口）。专业按同一条的学历缩小范围（网站也这么做）。
    async search(key, q) {
      const fb = byKey().get(key); if (!fb) return [];
      const p = fb.memoizedProps, school = p.item.customDataSource === 'school';
      const body = new URLSearchParams({ type: school ? 1 : 2, queryName: q, lang: 1 });
      if (!school) { const edu = sectionOf(fb)?.stateNode?.state?.data?.[p.itemId.replace(/_54(?=_|$)/, '_53')]; if (edu && typeof edu === 'string') body.set('education', edu); }
      const r = await fetch(`/wecruit/dic/fuzzyMatchDic?iSaJAx=isAjax&request_locale=zh_CN&t=${Date.now()}`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, credentials: 'include' });
      const j = await r.json();
      return (j?.data || []).map(x => ({ value: x.code, text: x.name, parent: x.parentName || '' }));
    },
    // 一次写一批，每项单独报告。
    // 同一批里连着写时，段落之间会互相用旧数据刷回去（2026-10-13 实测：结束时间、学校、专业写进去后又变空），
    // 所以写完等网页安顿下来再查一遍，丢了的补写，最多三轮。学校/专业放最后写：改学历会清空专业。
    async writeMany(items) {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const order = [...items].sort((a, b) => (a.raw && typeof a.raw === 'object') - (b.raw && typeof b.raw === 'object'));
      const res = new Map(items.map(({ key }) => [key, { key, ok: true }]));
      let todo = order;
      for (let round = 0; round < 3 && todo.length; round++) {
        const map = byKey();
        for (const { key, raw } of todo) {
          try { const fb = map.get(key); if (!fb) throw Error('字段已不在页面上'); writeFb(fb, raw); }
          catch (e) { res.set(key, { key, ok: false, error: String(e.message || e) }); }
        }
        await sleep(400);   // 等过网站 300ms 的防抖再查
        const now = byKey();
        todo = todo.filter(({ key, raw }) => res.get(key).ok && now.get(key) && !took(now.get(key), raw));
      }
      for (const { key } of todo) res.set(key, { key, ok: false, error: '网站没有收下这个值（日期先后不对时网站会拒收）' });
      return items.map(({ key }) => res.get(key));
    },
    // 加一条：点段落里的“添加新的 XX”（和用户点的是同一个）
    addRow(group) {
      const el = document.getElementById(group);
      const btn = el && (el.querySelector('.add-more-btn') || el.querySelector('.add-more'));
      if (!btn) return false;
      btn.click(); return true;
    },
    upload(key, file) {
      const fb = byKey().get(key); const input = fb && boxOf(fb)?.querySelector('input[type=file]');
      if (!input) throw Error('没找到上传框');
      const bin = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.mime }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    focus(key) {
      const fb = byKey().get(key); const el = fb && boxOf(fb);
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = el.style.boxShadow; el.style.boxShadow = '0 0 0 3px rgba(37,99,235,.6)'; setTimeout(() => { el.style.boxShadow = prev; }, 1600);
      return true;
    },
    mark(keys) {
      for (const el of document.querySelectorAll('[data-af-mark]')) { el.style.outline = el.dataset.afMark === '-' ? '' : el.dataset.afMark; el.removeAttribute('data-af-mark'); }
      const want = new Set(keys || []);
      for (const fb of comps()) {
        if (!want.has(fb.memoizedProps.itemId)) continue;
        const el = boxOf(fb); if (!el) continue;
        el.dataset.afMark = el.style.outline || '-'; el.style.outline = '2px dashed #f59e0b';
      }
      return true;
    },
  });
})();
