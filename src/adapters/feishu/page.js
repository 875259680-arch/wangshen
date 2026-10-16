// 飞书招聘（*.jobs.feishu.cn 公司官网投递页）页面侧。
// 整张表是一个 antd（atsx- 前缀）rc-form：每个字段组件身上有 rc-form 注入的 data-__field（字段路径，如 education[0].school）
// 和 onChange——用户在界面上选完也是走它，所以直接调它写值，校验、联动都和手填一样。
// 值的格式（2026-10-13 多点 DMALL 真实投递页）：文字、学校、专业、公司是字符串；下拉是选项 value（性别 1/2/3）；
// 起止时间是 [moment, moment]，“至今”存的是点选那一刻的 moment()；手机号是 {tel, code}；期望工作地点是城市编码数组。
// 这里只列原始数据、写原始值；对应关系和值格式在 adapters/feishu/mapping.js。
(() => {
  const P = window.__afPage;
  if (!P) return;
  const fiberOf = el => { const k = el && Object.keys(el).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const anchor = () => document.querySelector('form.atsx-form');

  function rootFiber() { let f = fiberOf(anchor()); while (f && f.return) f = f.return; return f; }
  function comps() {
    const out = [], st = [rootFiber()];
    while (st.length) {
      const fb = st.pop(); if (!fb) continue;
      const p = fb.memoizedProps;
      if (p && p['data-__field'] && typeof p.onChange === 'function') { out.push(fb); st.push(fb.sibling); continue; }
      st.push(fb.sibling, fb.child);
    }
    return out;
  }
  const hostOf = fb => { const st = [fb.child]; while (st.length) { const x = st.shift(); if (!x) continue; if (x.stateNode instanceof Element) return x.stateNode; st.push(x.child, x.sibling); } return null; };
  const boxOf = fb => hostOf(fb)?.closest('.atsx-form-item') || hostOf(fb);

  // 页面自己的 moment（起止时间必须是它造出来的对象）：从 webpack 已加载的模块里认出来，只认不执行别的模块
  let momentFn = null;
  function moment() {
    if (momentFn) return momentFn;
    const key = Object.keys(window).find(k => /^webpackChunk/.test(k));
    let req = null;
    if (key) window[key].push([[Symbol('af')], {}, r => { req = r; }]);
    for (const id of Object.keys(req?.m || {})) {
      const s = Function.prototype.toString.call(req.m[id]);
      if (s.length < 20000 || !s.includes('isMoment') || !s.includes('createFromInputFallback')) continue;
      const e = req(id), m = typeof e === 'function' ? e : e?.default;
      if (m?.isMoment) { momentFn = m; break; }
    }
    if (!momentFn) throw Error('没找到网页的日期组件库');
    return momentFn;
  }
  const isM = x => x && typeof x === 'object' && x._isAMomentObject;
  const ym = m => (isM(m) && m.isValid() ? m.format('YYYY-MM') : '');

  // 下拉选项在 Select 的 children（Option 元素）里
  const optionsOf = p => {
    const kids = (Array.isArray(p.children) ? p.children.flat(3) : [p.children]).filter(e => e && e.props && e.props.value !== undefined);
    return kids.map(e => ({ text: String(typeof e.props.children === 'string' ? e.props.children : e.props.label ?? e.props.title ?? e.props.value), value: e.props.value }));
  };
  function typeOf(fb) {
    const p = fb.memoizedProps, name = p['data-__field'].name;
    if (name === 'resume_attachment' || p.uploadFileProps) return 'file';
    if (name === 'mobile' || p.mobileCodes) return 'mobile';
    if ('hasToToday' in p || /\.period$/.test(name)) return 'period';
    if (Array.isArray(p.locationList)) return 'city';
    if (p.rows) return 'textarea';
    const opts = optionsOf(p);
    if (opts.length) return p.mode === 'multiple' || p.mode === 'tags' ? 'multiselect' : 'select';
    if (/^(id|formControlChangeFlag)$/.test(name)) return 'hidden';
    return 'text';
  }
  function rawOf(fb, type) {
    const v = fb.memoizedProps.value;
    if (type === 'period') {
      const [a, b] = Array.isArray(v) ? v : [];
      // “至今”就是结束时间等于点选时的“现在”：和今天同一天的算至今
      const now = !!fb.memoizedProps.hasToToday && isM(b) && b.isSame(moment()(), 'day');
      return { start: ym(a), end: now ? '至今' : ym(b) };
    }
    return v === undefined ? null : v;
  }
  function describe(fb) {
    const p = fb.memoizedProps, name = p['data-__field'].name, type = typeOf(fb);
    const m = name.match(/^([^[.]+)\[(\d+)\]/);
    const sec = hostOf(fb)?.closest('.createFormSection-container');
    const f = { key: name, id: name.replace(/\[\d+\]/g, ''), group: m ? m[1] : 'basic', row: m ? +m[2] : 0,
      groupTitle: sec?.querySelector('.createFormSection-text')?.innerText.trim() || '',
      // 附件简历的上传框自己没有 label，用段落名（“附件简历”）
      type, label: (boxOf(fb)?.querySelector('label')?.innerText || '').replace(/\s+/g, '') || (type === 'file' ? sec?.querySelector('.createFormSection-text')?.innerText.trim() || '附件简历' : ''),
      required: !!boxOf(fb)?.querySelector('label.atsx-form-item-required'),
      options: type === 'select' || type === 'multiselect' ? optionsOf(p) : [],
      hasNow: !!p.hasToToday, raw: rawOf(fb, type) };
    // 能解析简历的上传框（hasParseFeature）：引擎先传简历、等网站解析完再填
    if (type === 'file') f.hint = (p.hasParseFeature ? '上传后自动解析 ' : '') + (sec?.innerText || boxOf(fb)?.innerText || '').replace(/\s+/g, ' ').slice(0, 160);
    return f;
  }
  const byKey = () => new Map(comps().map(fb => [fb.memoizedProps['data-__field'].name, fb]));

  function writeFb(fb, raw) {
    const p = fb.memoizedProps, type = typeOf(fb);
    if (type === 'period') {
      const M = moment(), at = s => (s ? M(s, 'YYYY-MM').startOf('month') : null);
      p.onChange([at(raw.start), raw.end === '至今' ? M() : at(raw.end)]);
    } else p.onChange(raw);
  }
  const same = (fb, raw) => {
    const type = typeOf(fb), now = rawOf(fb, type);
    if (type === 'period') return now.start === (raw.start || '') && now.end === (raw.end || '');
    return JSON.stringify(now ?? null) === JSON.stringify(raw ?? null);
  };

  P.register({
    id: 'feishu',
    detect: () => /(^|\.)jobs\.feishu\.cn$|(^|\.)feishu\.cn$/.test(location.hostname) && !!fiberOf(anchor()) && comps().length > 0,
    list: () => comps().filter(fb => typeOf(fb) !== 'hidden').map(describe),
    // 期望工作地点的城市树摊平：国家 → 省 → 市
    tree(key) {
      const fb = byKey().get(key); const out = [];
      const walk = (arr, parent) => { for (const n of arr || []) { const l = n.location || {}; if (!l.code) continue; out.push({ id: l.code, name: l.name, parent }); walk(n.children, l.code); } };
      walk(fb?.memoizedProps.locationList, null);
      return out;
    },
    // 还没有任何条目的段落（实习、项目……开头只有一个“添加”）：引擎据此决定先点“添加”
    emptyGroups() {
      const have = new Set(comps().map(fb => (fb.memoizedProps['data-__field'].name.match(/^([^[.]+)\[/) || [])[1]).filter(Boolean));
      return [...document.querySelectorAll('.createFormSection-mutiple[class*="resumeEditForm-"]')].map(el => {
        const g = ([...el.classList].find(c => c.startsWith('resumeEditForm-')) || '').slice('resumeEditForm-'.length);
        return { group: g, title: el.querySelector('.createFormSection-text')?.innerText.trim() || '' };
      }).filter(x => x.group && !have.has(x.group));
    },
    // “没有工作经历”这类勾选框（不在表单数据里，是段落自己的开关）：点它的 label，和用户点的一样
    markNone(group) {
      const sec = document.querySelector(`.resumeEditForm-${CSS.escape(group)}`);
      const box = sec?.querySelector('label[class*="noExperience"], label.atsx-checkbox-wrapper');
      const inp = box?.querySelector('input[type=checkbox]');
      if (!box || !inp || !/没有|无/.test(box.textContent)) return false;
      if (!inp.checked) box.click();
      return true;
    },
    // rc-form 写值是同步的，但联动（选了学历再刷新别的字段）在下一轮渲染：写完稍等再查，丢了的补写一次
    async writeMany(items) {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const res = new Map(items.map(({ key }) => [key, { key, ok: true }]));
      let todo = items;
      for (let round = 0; round < 2 && todo.length; round++) {
        const map = byKey();
        for (const { key, raw } of todo) {
          try { const fb = map.get(key); if (!fb) throw Error('字段已不在页面上'); writeFb(fb, raw); }
          catch (e) { res.set(key, { key, ok: false, error: String(e.message || e) }); }
        }
        await sleep(200);
        const now = byKey();
        todo = todo.filter(({ key, raw }) => res.get(key).ok && now.get(key) && !same(now.get(key), raw));
      }
      return items.map(({ key }) => res.get(key));
    },
    // 加一条：点该段落里的“添加”（段落空着时在标题旁边，有条目时在最后一条下面）
    addRow(group) {
      const sec = document.querySelector(`.resumeEditForm-${CSS.escape(group)}`);
      const leaf = sec && [...sec.querySelectorAll('span,div,a,button')].reverse().find(e => e.childElementCount <= 1 && /^\s*添加\s*$/.test(e.textContent));
      if (!leaf) return false;
      (leaf.closest('button,a,[role=button]') || leaf).click();
      return true;
    },
    upload(key, file) {
      const fb = byKey().get(key);
      const input = fb && (hostOf(fb)?.closest('.createFormSection-container') || boxOf(fb))?.querySelector('input[type=file]');
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
        if (!want.has(fb.memoizedProps['data-__field'].name)) continue;
        const el = boxOf(fb); if (!el) continue;
        el.dataset.afMark = el.style.outline || '-'; el.style.outline = '2px dashed #f59e0b';
      }
      return true;
    },
  });
})();
