// 北森页面侧：字段组件带 cmp_id / cmp_name / cmp_type / cmp_data / value / text / onChange，写入统一是 onChange({text, value})。
// 这里只列原始数据、写原始值；对应关系和值格式在 core/platform-beisen.js。
(() => {
  const P = window.__afPage;
  if (!P) return;
  const fiberOf = el => { const k = el && Object.keys(el).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const anchor = () => document.querySelector('[class*="phoenix"]');

  // 字段组件：一个字段外面包了好几层（cmp_id 相同），取最外层后不再往里走。
  // 不能按 cmp_id 全局去重：同一块里“添加”出来的第 2、3 条和第 1 条共用 cmp_id，
  // 以前那样去重会把新条目全丢掉 → 永远以为只有 1 条 → 每次都再点“添加”，空条目越加越多（2026-10-12 明阳实测）。
  function comps() {
    let root = fiberOf(anchor()); while (root && root.return) root = root.return;
    const out = [], st = [root];
    while (st.length) {
      const fb = st.pop(); if (!fb) continue;
      const p = fb.memoizedProps;
      if (p && p.cmp_id && p.cmp_type && typeof p.onChange === 'function' && 'value' in p && !p.sub_cmps) { out.push(fb); st.push(fb.sibling); continue; }
      st.push(fb.sibling, fb.child);
    }
    return out;
  }
  // 字段下面所有真实 DOM（顶层几个元素）
  const hostsOf = fb => { const out = [], st = [fb.child]; while (st.length) { const x = st.pop(); if (!x) continue; if (x.stateNode instanceof Element) { out.push(x.stateNode); st.push(x.sibling); continue; } st.push(x.sibling, x.child); } return out; };
  const hostOf = fb => hostsOf(fb)[0] || null;
  // 结束时间旁边的“至今”勾选框（日期组件自带）
  const nowBox = fb => { for (const h of hostsOf(fb)) { const t = [...h.querySelectorAll('span,label')].find(e => e.childElementCount === 0 && e.textContent.trim() === '至今'); if (t) return t.closest('[class*=checkbox],[class*=Checkbox]') || t.parentElement; } return null; };

  function list() {
    const rows = new Map();
    const fields = comps();
    // Beisen also uses RecruitmentSchoolPractice for research/project blocks.
    // Classify the whole block from its explicit title, so sibling date/desc
    // controls follow the same profile list. Unmarked historical blocks stay campus.
    const projectPractice = fields.some(fb => {
      const p = fb.memoizedProps, d = p.cmp_data || {};
      return String(p.cmp_name || '').startsWith('RecruitmentSchoolPractice_') &&
        /在校科研及实践项目/.test(String(p.cmp_label || d.title || ''));
    });
    return fields.map(fb => {
      const p = fb.memoizedProps, d = p.cmp_data || {};
      // 多条目（教育、实习……）同名字段按出现顺序编号。
      const row = rows.get(p.cmp_name) || 0; rows.set(p.cmp_name, row + 1);
      return {
        key: `${p.cmp_name}|${row}`, id: p.cmp_name, cmpId: p.cmp_id, group: (p.cmp_name || '').split('_')[0], groupTitle: '', row,
        ...(projectPractice && String(p.cmp_name || '').startsWith('RecruitmentSchoolPractice_') ? { listKind: 'project' } : {}),
        type: p.cmp_type, label: p.cmp_label || d.title || '', required: !!d.required, disabled: d.cmp_status === 'readonly' || d.cmp_status === 'disabled',
        options: Array.isArray(d.datasource) ? d.datasource.filter(o => o.isActive !== '0').map(o => ({ text: o.text, value: o.value })) : [],
        format: d.data_format || '', areaUrl: p.cmp_type === 'BC_PopArea' ? d.datasourceurl || '' : '',
        hasNow: p.cmp_type === 'BC_DateTime' && !!nowBox(fb),
        hint: /Uploader$/.test(p.cmp_type) ? hostsOf(fb).map(h => h.innerText || '').join(' ').replace(/\s+/g, ' ').slice(0, 160) : '',
        raw: { text: p.text ?? '', value: p.value ?? '' },
      };
    });
  }
  const byKey = () => { const m = new Map(); const ls = list(); comps().forEach((fb, i) => m.set(ls[i].key, fb)); return m; };

  function writeFb(fb, raw) {
    if (raw && raw.now) {
      // 点网页自己的“至今”勾选框：界面勾选状态和值（9999/12）都由组件自己设
      const box = nowBox(fb); if (!box) throw Error('没找到“至今”勾选框');
      if (!/^9999/.test(String(fb.memoizedProps.value || ''))) box.click();
      return;
    }
    fb.memoizedProps.onChange(raw);
  }

  P.register({
    id: 'beisen',
    detect: () => /(^|\.)zhiye\.com$|(^|\.)beisen\.com$|italent\.(cn|link)$/.test(location.hostname) && !!fiberOf(anchor()) && comps().length > 0,
    list,
    writeMany(items) {
      const map = byKey();
      return items.map(({ key, raw }) => {
        try { const fb = map.get(key); if (!fb) throw Error('字段已不在页面上'); writeFb(fb, raw); return { key, ok: true }; }
        catch (e) { return { key, ok: false, error: String(e.message || e) }; }
      });
    },
    // 北森每个多条目块底下有“添加教育经历”“添加实习经历”……（带 onClick 的 div）
    addRow(title) {
      const el = [...document.querySelectorAll('div,span,button,a')].find(e => e.childElementCount <= 2 && e.textContent.trim() === '添加' + title);
      if (!el) return false;
      el.click(); return true;
    },
    // 材料上传：把文件放进该字段里的 <input type=file>，和用户选文件一样触发上传
    upload(key, file) {
      const fb = byKey().get(key); if (!fb) throw Error('字段已不在页面上');
      const input = hostsOf(fb).map(h => h.matches('input[type=file]') ? h : h.querySelector('input[type=file]')).find(Boolean);
      if (!input) throw Error('没找到上传框');
      const bin = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.mime }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    focus(key) {
      const fb = byKey().get(key); const el = fb && hostOf(fb);
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = el.style.boxShadow; el.style.boxShadow = '0 0 0 3px rgba(37,99,235,.6)'; setTimeout(() => { el.style.boxShadow = prev; }, 1600);
      return true;
    },
    mark(keys) {
      for (const el of document.querySelectorAll('[data-af-mark]')) { el.style.outline = el.dataset.afMark === '-' ? '' : el.dataset.afMark; el.removeAttribute('data-af-mark'); }
      const map = byKey();
      for (const k of keys || []) { const el = map.get(k) && hostOf(map.get(k)); if (el) { el.dataset.afMark = el.style.outline || '-'; el.style.outline = '2px dashed #f59e0b'; } }
      return true;
    },
  });
})();
