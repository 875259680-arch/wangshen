// Moka 页面侧：每个字段组件都带 fieldInfo + _get_/_set_（读值/写值），起止时间组件带 onStartChange/onEndChange。
// 这里只列原始数据、写原始值；对应关系和值格式在 adapters/moka/mapping.js。
(() => {
  const P = window.__afPage;
  if (!P) return;
  const fiberOf = el => { const k = el && Object.keys(el).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const anchor = () => document.querySelector('[class*="apply-field-"]');

  function rootFiber() { let f = fiberOf(anchor()); while (f && f.return) f = f.return; return f; }
  // 全部字段组件（按文档顺序）。同一个字段的多层包装共用一个 _set_，用它去重。
  function comps() {
    const out = [], seen = new Set(), st = [rootFiber()];
    while (st.length) {
      const fb = st.pop(); if (!fb) continue;
      const p = fb.memoizedProps;
      if (p && p.fieldInfo && typeof p._set_ === 'function' && !seen.has(p._set_)) { seen.add(p._set_); out.push(fb); }
      st.push(fb.sibling, fb.child);
    }
    return out;
  }
  const blockOf = fb => { for (let b = fb.return; b; b = b.return) if (b.memoizedProps?.blockInfo) return b; return null; };
  const hostOf = fb => { const st = [fb.child]; while (st.length) { const x = st.shift(); if (!x) continue; if (x.stateNode instanceof Element) return x.stateNode; st.push(x.child, x.sibling); } return null; };
  const dateHandler = fb => { const st = [fb.child]; while (st.length) { const x = st.shift(); if (!x) continue; if (typeof x.memoizedProps?.onEndChange === 'function') return x.memoizedProps; st.push(x.child, x.sibling); } return null; };
  // 选项只留文字和值（城市/站点保留两层结构），不把组件对象原样发出去。
  const slimOpt = o => typeof o !== 'object' || !o ? o : o.sites ? { cityName: o.cityName, sites: o.sites.map(s => ({ id: s.id, name: s.name })) }
    : { label: o.label, value: o.value, cityName: o.cityName, name: o.name, id: o.id };

  function describe(fb) {
    const p = fb.memoizedProps, fi = p.fieldInfo, b = blockOf(fb), bi = b?.memoizedProps.blockInfo || {};
    const row = bi.multi ? (p.index ?? 0) : 0;
    let raw;
    try { raw = p._get_(); } catch (_) { raw = undefined; }
    const f = { key: `${bi.id || fi.blockId}|${row}|${fi.id}`, id: fi.id, group: bi.id || fi.blockId, groupTitle: bi.title || '', multi: !!bi.multi,
      // 起止时间组件挂在“开始时间”字段上，但开始、结束都归它管
      row, type: fi.type, label: fi.type === 'date_info' && fi.name === '开始时间' ? '起止时间' : fi.name, required: !!fi.isRequired, builtin: !!fi.isBuiltin, disabled: !!(fi.disabled || fi.isNotEditable),
      options: Array.isArray(fi.options) ? fi.options.map(slimOpt) : [] };
    // 上传框旁的说明（“上传后会自动解析、填充申请表”）：引擎据此决定先传简历、等解析完再填
    if (fi.type === 'file_upload') f.hint = (hostOf(fb)?.closest('[class*="apply-field-"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160);
    if (fi.type === 'date_info') {
      // 结束时间不在这个字段上，在所在条目的整行值里（{startDate, endDate, ...}）
      let rowVal = null;
      try { const all = b?.memoizedProps._get_(); rowVal = Array.isArray(all) ? all[row] : all; } catch (_) {}
      const h = dateHandler(fb);
      // 不在经历块里的（个人信息里的“毕业时间”）自己的值就是 {startDate, endDate}；以前当成字符串，回读成“[object Object]”（2026-10-13 诊断）
      const own = raw && typeof raw === 'object' ? raw : null;
      f.raw = { start: rowVal?.startDate || own?.startDate || (own ? '' : raw) || '', end: rowVal?.endDate || own?.endDate || '' };
      f.allowNow = !!h?.allowNow; f.withoutEnd = !!h?.withoutEnd;
    } else f.raw = raw === undefined ? null : raw;
    return f;
  }
  const find = key => comps().find(fb => describe(fb).key === key) || null;

  // 年月 → 组件的 {year, month}（月份不补零，和界面下拉一致）
  const ym = s => { const m = String(s).match(/^(\d{4})-(\d{1,2})$/); return m ? { year: m[1], month: String(+m[2]) } : null; };

  function writeFb(fb, raw) {
    const p = fb.memoizedProps;
    if (p.fieldInfo.type === 'date_info') {
      const h = dateHandler(fb);
      if (!h) throw Error('没找到起止时间组件');
      if (raw.start) { const v = ym(raw.start); if (!v) throw Error(`开始时间格式不对：${raw.start}`); h.onStartChange(v); }
      // “至今”是结束年份下拉里值为“至今”的一项（组件自己转换），只有 allowNow 的经历块有。
      if (raw.end === '至今') { if (!h.allowNow) throw Error('这个网页的结束时间没有“至今”选项'); h.onEndChange({ year: '至今', month: null }); }
      else if (raw.end) { const v = ym(raw.end); if (!v) throw Error(`结束时间格式不对：${raw.end}`); h.onEndChange(v); }
      return true;
    }
    p._set_(raw);
    return true;
  }

  P.register({
    id: 'moka',
    detect: () => /(^|\.)mokahr\.com$/.test(location.hostname) && !!fiberOf(anchor()),
    list: () => comps().map(describe),
    // 一次写一批：字段表只建一次（逐个 find 是 O(n²)）。每项单独报告成败，一项出错不影响其它项。
    writeMany(items) {
      const map = new Map(comps().map(fb => [describe(fb).key, fb]));
      return items.map(({ key, raw }) => {
        try { const fb = map.get(key); if (!fb) throw Error('字段已不在页面上'); writeFb(fb, raw); return { key, ok: true }; }
        catch (e) { return { key, ok: false, error: String(e.message || e) }; }
      });
    },
    // 给多条目块再加一条：点块里的“添加”按钮（和用户点的是同一个）。返回是否点到。
    addRow(group) {
      const st = [rootFiber()];
      while (st.length) {
        const fb = st.pop(); if (!fb) continue;
        if (fb.memoizedProps?.blockInfo?.id === group) {
          const el = hostOf(fb)?.closest('[data-nav-id]') || hostOf(fb)?.parentElement;
          const btn = el && [...el.querySelectorAll('button')].reverse().find(b => /^\s*[+＋]?\s*添加/.test(b.textContent));
          if (!btn) return false;
          btn.click(); return true;
        }
        st.push(fb.sibling, fb.child);
      }
      return false;
    },
    // 材料上传：把文件放进该字段里的 <input type=file>，和用户选文件一样触发上传
    upload(key, file) {
      const fb = find(key); const box = fb && (hostOf(fb)?.closest('[class*="apply-field-"]') || hostOf(fb));
      const input = box?.querySelector('input[type=file]');
      if (!input) throw Error('没找到上传框');
      const bin = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.mime }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    focus(key) {
      const fb = find(key); const el = fb && (hostOf(fb)?.closest('[class*="apply-field-"]') || hostOf(fb));
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = el.style.boxShadow; el.style.boxShadow = '0 0 0 3px rgba(37,99,235,.6)'; setTimeout(() => { el.style.boxShadow = prev; }, 1600);
      return true;
    },
    // 需要人工处理的字段描橙色虚线；传空数组即清除。
    mark(keys) {
      for (const el of document.querySelectorAll('[data-af-mark]')) { el.style.outline = el.dataset.afMark === '-' ? '' : el.dataset.afMark; el.removeAttribute('data-af-mark'); }
      const want = new Set(keys || []);
      for (const fb of comps()) {
        if (!want.has(describe(fb).key)) continue;
        const el = hostOf(fb)?.closest('[class*="apply-field-"]'); if (!el) continue;
        el.dataset.afMark = el.style.outline || '-'; el.style.outline = '2px dashed #f59e0b';
      }
      return true;
    },
  });
})();
