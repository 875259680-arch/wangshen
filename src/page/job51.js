// 前程无忧 51job 校招“简历录入”页（xyz.51job.com/External/MyResume/FillInResume.aspx，分步：基本信息 → 教育 → …）页面侧。
// 每个字段是 <dl dlcolname="Gender"><dt>性别 *</dt><dd>原生 select / input</dd></dl>，dlcolname 是系统字段名（各公司一样）。
// 两级下拉（省 → 市）是 ddl_X 选完触发内联 onchange 才把下一级选项填出来；生日是两个没有 id 的年、月下拉。
// 这里只列原始数据、按文字选项写；对应关系和值格式在 core/platform-job51.js。
(() => {
  const P = window.__afPage;
  if (!P) return;
  const uploadFrame = dl => [...dl.querySelectorAll('iframe')].find(e => /\/CommPage\/Pages\/UpLoad\.aspx/i.test(e.getAttribute('src') || ''));
  const rows = () => [...document.querySelectorAll('dl[dlcolname]')].filter(dl => dl.getClientRects().length && (controls(dl).length || uploadFrame(dl)));
  const controls = dl => [...dl.querySelectorAll('dd select, dd input:not([type=hidden]):not([type=submit]):not([type=button]), dd textarea')].filter(e => e.getClientRects().length);
  const text = s => (s ? s.options[s.selectedIndex]?.text || '' : '');
  const blank = t => !t || /^-*请选择-*$/.test(t.trim());
  const valOf = c => (c.tagName === 'SELECT' ? (blank(text(c)) ? '' : text(c).trim()) : c.value);
  // .mapi can be a hidden navigation label; use the visible page heading first.
  const step = () => ([...document.querySelectorAll('h1,h2,.mapi')].find(e => e.getClientRects().length && e.innerText?.trim())?.innerText || '').trim();

  function describe(dl, i) {
    const cs = controls(dl), name = dl.getAttribute('dlcolname'), frame = uploadFrame(dl);
    const idm = (cs.find(c => /^(cc|ddl)_/.test(c.id))?.id || (frame && dl.querySelector('input[type=hidden]')?.id) || '').match(/_(\d+)_(\d+)$/);
    const sec = idm ? idm[1] : '0', row = idm ? +idm[2] - 1 : 0;
    const shape = cs.map(c => (c.tagName === 'SELECT' ? 's' : c.tagName === 'TEXTAREA' ? 'a' : c.type === 'radio' ? 'r' : c.type === 'checkbox' ? 'c' : 't')).join('');
    const editStyle = dl.getAttribute('editstyle') || cs.find(c => c.getAttribute('editstyle'))?.getAttribute('editstyle') || '';
    return { key: `${name}|${sec}|${row}`, id: name, group: step(), groupTitle: step(), row, type: frame ? 'file' : shape, editStyle,
      label: (dl.querySelector('dt')?.innerText || '').replace(/[\s*＊]/g, ''), required: !!dl.querySelector('dt .must'),
      // 第一个下拉的选项（第二级要等第一级选完才有，不列）
      options: cs[0]?.tagName === 'SELECT' ? [...cs[0].options].filter(o => !blank(o.text)).map(o => ({ text: o.text.trim(), value: o.text.trim(),
        children: cascadeDict(cs[0]) ? dictChildren(cascadeDict(cs[0]), o.value) : [] })) : [],
      raw: frame ? dl.querySelector('input[type=hidden]')?.value || '' : cs.map(valOf), idx: i };
  }
  const byKey = () => new Map(rows().map((dl, i) => [describe(dl, i).key, dl]));
  const norm = t => String(t || '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)$/g, '');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function inRange(t, n) {
    let m = t.match(/(\d+)\D{0,3}[-~至](\d+)/); if (m) return n >= +m[1] && n <= +m[2];
    m = t.match(/(\d+)\D{0,2}以下/); if (m) return n < +m[1];
    m = t.match(/(\d+)\D{0,2}以上/); if (m) return n >= +m[1];
    return false;
  }
  // 一个下拉：在候选文字里按顺序找第一个对得上的选项（下一级是等上一级的 onchange 填出来的，最多等 2 秒）
  async function pick(sel, wants) {
    for (let t = 0; t < 20; t++) {
      const opts = [...sel.options];
      for (const w of wants) {
        // { num: 525 }：选包含这个数的区间（“CET6 425-550分”“550分以上”“425分以下”）
        const o = w && typeof w === 'object' ? (Number.isFinite(+w.num) ? opts.find(o => inRange(o.text, +w.num))
          : typeof w.search === 'string' ? opts.find(o => normExact(o.text) === normExact(w.search)) : null)
          : opts.find(o => o.text.trim() === w) || opts.find(o => norm(o.text) === norm(w));
        if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      }
      if (opts.filter(o => !blank(o.text)).length > 1) return false;   // 选项已经出来了，就是没有
      await sleep(100);
    }
    return false;
  }
  const normExact = s => String(s || '').replace(/\s+/g, '').trim();
  const nameCore = s => normExact(s).replace(/[（(][^）)]*[）)]$/, '');
  function dictChildren(dictName, parentValue) {
    if (!['D_51JobSchool', 'D_Major'].includes(dictName) || typeof window.GetDictTable !== 'function') return [];
    try {
      const row = window.GetDictTable(dictName)?.Rows?.[parentValue];
      const raw = row?.Value;
      if (!raw) return [];
      return String(raw).split('|').map(part => {
        const comma = part.indexOf(',');
        return comma < 0 ? { text: part, value: part } : { text: part.slice(0, comma), value: part.slice(comma + 1) };
      }).filter(x => x.text);
    } catch (_) { return []; }
  }
  function cascadeDict(sel) {
    const m = String(sel.getAttribute('onchange') || '').match(/^\s*DDL_OnChange1\s*\(\s*'((?:D_51JobSchool|D_Major))'/i);
    return m?.[1] || null;
  }
  async function pickCascade(parent, child, request, dictName) {
    const wanted = normExact(request.search);
    const parents = [...parent.options].filter(o => !blank(o.text));
    if (request.parent && request.parent !== true) {
      const p = parents.find(o => normExact(o.text) === normExact(request.parent));
      if (!p) return false;
      parent.value = p.value;
      parent.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(0);
    } else {
      const matches = parents.flatMap(o => dictChildren(dictName, o.value).filter(c => nameCore(c.text) === nameCore(wanted)).map(c => ({ option: o, child: c })));
      const exacts = matches.filter(x => normExact(x.child.text) === wanted);
      const candidates = exacts.length ? exacts : matches;
      const match = candidates.length === 1 ? candidates[0] : null;
      if (!match) return false;
      parent.value = match.option.value;
      parent.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(0);
    }
    const hits = [...child.options].filter(o => nameCore(o.text) === nameCore(wanted));
    const exact = [...child.options].find(o => normExact(o.text) === wanted) || (hits.length === 1 ? hits[0] : null);
    if (!exact) return false;
    child.value = exact.value;
    child.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  P.register({
    id: 'job51',
    detect: () => /(^|\.)51job\.com$/.test(location.hostname) && rows().length > 0,
    list: () => rows().map(describe),
    // raw：每个控件一项。下拉给“可接受的选项文字”数组（按优先顺序），输入框给字符串
    async writeMany(items) {
      const map = byKey(), out = [];
      for (const { key, raw } of items) {
        try {
          const dl = map.get(key); if (!dl) throw Error('字段已不在页面上');
          const cs = controls(dl);
          for (let i = 0; i < cs.length && i < raw.length; i++) {
            const c = cs[i], v = raw[i];
            if (v == null) continue;
            if (c.tagName === 'SELECT') {
              if (v && typeof v === 'object' && typeof v.search === 'string' && v.parent !== undefined) {
                const dict = cascadeDict(cs[i - 1]);
                if (!cs[i - 1] || !dict || !(await pickCascade(cs[i - 1], c, v, dict))) throw Error(`级联选项中没有精确匹配“${v.search}”`);
              } else if (!(await pick(c, Array.isArray(v) ? v : [v]))) throw Error(`选项里没有“${[].concat(v)[0]}”`);
            }
            else {
              // readonly date inputs open a calendar on focus; set their exact date without focusing.
              if (!c.readOnly) c.focus();
              c.value = String(v); c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true }));
              if (!c.readOnly) c.blur();
            }
          }
          out.push({ key, ok: true });
        } catch (e) { out.push({ key, ok: false, error: String(e.message || e) }); }
      }
      return out;
    },
    async addRow(group) {
      if (group !== step()) return false;
      const before = rows().length;
      const button = [...document.querySelectorAll('input[title="添加"][onclick]')].find(e => e.getClientRects().length && /^AppendControls\(this\)/.test(e.getAttribute('onclick')));
      if (!button) return false;
      button.click();
      await sleep(30);
      return rows().length > before;
    },
    upload(key, file) {
      const dl = byKey().get(key), frame = dl && uploadFrame(dl);
      const input = frame?.contentDocument?.querySelector('input[type=file]') || dl?.querySelector('input[type=file]');
      if (!input) throw Error('没找到上传框');
      const bin = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.mime }));
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      if (frame) {
        const button = frame.contentDocument?.getElementById('btnUpload');
        if (!button) throw Error('上传工具尚未加载');
        button.click();
      }
      return true;
    },
    focus(key) {
      const el = byKey().get(key); if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = el.style.boxShadow; el.style.boxShadow = '0 0 0 3px rgba(37,99,235,.6)'; setTimeout(() => { el.style.boxShadow = prev; }, 1600);
      return true;
    },
    mark(keys) {
      for (const el of document.querySelectorAll('[data-af-mark]')) { el.style.outline = el.dataset.afMark === '-' ? '' : el.dataset.afMark; el.removeAttribute('data-af-mark'); }
      const want = new Set(keys || []), map = byKey();
      for (const k of want) { const el = map.get(k); if (!el) continue; el.dataset.afMark = el.style.outline || '-'; el.style.outline = '2px dashed #f59e0b'; }
      return true;
    },
  });
})();
