// 执行引擎：扫描 → 补条目 → 一次性问 AI 要值 → 逐个填写并核验 → 再扫一遍处理新出现的字段。
(() => {
  if (globalThis.AF?.domEngine) return;
  const AF = globalThis.AF;
  const { sleep, norm, text, visible, settle, click } = AF.util;
  const { dom } = AF.util;
  const { scan, plain, headings } = AF.scan;
  const { fill, fillFile, matches, readOptions } = AF.controls;

  const send = msg => new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, r => resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r)); }
    catch (e) { resolve({ error: '扩展已更新，请刷新页面' }); }
  });

  let running = false, cancelled = false;
  let baseline = null;                 // key → 值；用来发现用户手动改过的字段
  const report = { results: [], status: '', done: 0, total: 0 };
  const listeners = new Set();
  const emit = patch => { Object.assign(report, patch); for (const l of listeners) l(report); };

  const refindBy = key => () => scan().find(x => x.key === key) || null;

  // ---------- 重复条目：资料里有几条就补到几条 ----------
  const LISTS = [
    [/教育|学历|学习经历|education/i, 'educations'],
    [/实习|internship/i, 'internships'],
    [/工作|职业经历|work|employment/i, 'workExperiences'],
    [/项目|project/i, 'projects'],
    [/校园|学生干部|社团|社会实践|在校经历|活动经历|campus/i, 'campusExperiences'],
    [/证书|资格|certificate/i, 'certificates'],
    [/家庭|家属|family/i, 'familyMembers'],
    [/获奖|奖励|荣誉|award/i, 'awards'],
  ];
  const ADD = /^[+＋]?\s*(添加|新增|增加|继续添加|再添加|add)/i;

  function listCount(section, profile, pageSections) {
    const hit = LISTS.find(([re]) => re.test(section));
    if (!hit) return 0;
    let name = hit[1];
    if (name === 'workExperiences' && !(profile.workExperiences?.length) && !pageSections.some(s => /实习/.test(s))) name = 'internships';
    const v = profile[name];
    return Array.isArray(v) ? v.length : 0;
  }

  async function expandRows(profile) {
    const added = [];
    for (let guard = 0; guard < 12; guard++) {
      const fields = scan();
      const heads = headings(new Set(fields.map(f => norm(f.label))));
      const names = heads.map(h => h.text);
      let clicked = false;
      for (let i = 0; i < heads.length; i++) {
        const h = heads[i], next = heads[i + 1]?.el;
        const want = listCount(h.text, profile, names);
        if (!want) continue;
        const inSec = fields.filter(f => f.section === h.text);
        if (!inSec.length && !want) continue;
        const rows = inSec.length ? Math.max(...inSec.map(f => f.row)) + 1 : 0;
        if (rows >= want) continue;
        // 只认“文字本身就是添加”的最小元素，避免点到“+ 添加 …… 删除”这一整行的空白处。
        const adds = [...dom.all(document, 'button,a,span,div,[role=button]')].filter(el =>
          ADD.test(text(el)) && text(el).length <= 12 && !/附件|文件|上传|照片|图片|删除/.test(text(el)) && visible(el));
        const btn = adds.filter(el => !adds.some(o => o !== el && dom.contains(el, o))).map(el => dom.closest(el, 'button,a,[role=button]') || el).find(el =>
          true
          && (dom.position(h.el, el) & Node.DOCUMENT_POSITION_FOLLOWING)
          && (!next || (dom.position(el, next) & Node.DOCUMENT_POSITION_FOLLOWING))
          && !dom.closest(el, '#' + AF.scan.PANEL_ID));
        if (!btn) continue;
        click(btn);
        await settle(150, 1500);
        const after = scan().filter(f => f.section === h.text);
        const rowsAfter = after.length ? Math.max(...after.map(f => f.row)) + 1 : 0;
        if (rowsAfter > rows) { added.push(h.text); clicked = true; break; }
      }
      if (!clicked) break;
    }
    return added;
  }

  // 网页上的条目比资料多（多为网站解析简历时重复生成）：标出来让用户删，不自动删。
  function extraRows(profile) {
    const fields = scan();
    const heads = headings(new Set(fields.map(f => norm(f.label))));
    const names = heads.map(h => h.text);
    const out = [];
    for (const h of heads) {
      const want = listCount(h.text, profile, names);
      if (!want) continue;
      const inSec = fields.filter(f => f.section === h.text);
      const rows = inSec.length ? Math.max(...inSec.map(f => f.row)) + 1 : 0;
      if (rows <= want) continue;
      const first = inSec.find(f => f.row === want);
      out.push({ key: first?.key, label: `${h.text}：第 ${want + 1}${rows - 1 > want ? '~' + rows : ''} 条是多出来的`, section: h.text, state: 'extra',
        reason: `你的资料只有 ${want} 条，网页上有 ${rows} 条（通常是网站解析简历时重复生成的），请核对后删除` });
    }
    return out;
  }

  // ---------- 主流程 ----------
  async function run({ overwrite = false, expand = true } = {}) {
    if (running) return report;
    running = true; cancelled = false;
    const results = [];
    emit({ results, status: '读取资料…', done: 0, total: 0, running: true });
    try {
      // 后台标签页里浏览器会暂停动画、放慢计时器，下拉和日历弹不出来——必须在前台填。
      if (document.hidden) throw Error('请先切换到这个网页（保持在前台）再填写');
      const state = await send({ type: 'STATE' });
      if (state?.error) throw Error(state.error);
      if (expand && state.autoExpand) {
        emit({ status: '检查需要补充的条目…' });
        const added = await expandRows(state.profile || {});
        if (added.length) emit({ status: `已添加条目：${added.join('、')}` });
      }
      const attempted = new Set();
      for (let pass = 0; pass < 3 && !cancelled; pass++) {
        const all = scan();
        // 你亲手改过并记住的问题：网页上已有的值（多为网站自动解析）和记忆不同，就以记忆为准。
        const filled = all.filter(f => f.value && f.kind !== 'file' && !attempted.has(f.key));
        const mem = !overwrite && filled.length ? await send({ type: 'REMEMBERED', fields: filled.map(plain), page: { host: location.host, path: location.pathname, search: location.search } }) : null;
        const fix = new Set(Object.entries(mem?.values || {}).filter(([k, v]) => { const f = filled.find(x => x.key === k); return f && !matches(f, f.value, v); }).map(([k]) => k));
        const todo = all.filter(f => f.kind !== 'file' && !attempted.has(f.key) && (overwrite || !f.value || fix.has(f.key)));
        for (const f of all) if (f.value && !overwrite && !fix.has(f.key) && !attempted.has(f.key) && pass === 0) results.push({ key: f.key, label: f.label, section: f.section, state: 'kept' });
        if (!todo.length) break;
        emit({ status: pass ? `发现 ${todo.length} 个新出现的字段…` : `读取资料，准备填写 ${todo.length} 个字段…`, total: report.total + todo.length });
        const page = { host: location.host, path: location.pathname, search: location.search, title: document.title };
        // 四个同题日期下拉可能分别是年/月；不读选项就会把完整年月填到“年份”，以前回读精度过松会假成功。
        const splitTime = f => /时间|日期|年月|起止/.test(f.label) && all.filter(x => x.kind === 'select' && x.label === f.label && x.section === f.section && x.row === f.row).length === 4;
        const split = new Set(todo.filter(splitTime).map(f => f.key));
        // 先拿记忆、缓存和本地一定答得对的值立刻开填；其余同时交给 AI。以前要等 AI 把整页答完才动第一个字段。
        const fast = await send({ type: 'RESOLVE', phase: 'fast', fields: todo.filter(f => !split.has(f.key)).map(plain), page });
        if (fast?.error && !fast.values) throw Error(fast.error);
        if (fast?.error) emit({ warning: fast.error });
        const values = { ...(fast?.values || {}) }, source = { ...(fast?.source || {}) };
        const offline = new Set(fast?.offline || []);
        const later = new Set([...(fast?.pending || []), ...split]);
        const aiFields = todo.filter(f => (fast?.pending || []).includes(f.key));
        const aiJob = aiFields.length ? send({ type: 'RESOLVE', fields: aiFields.map(plain), page }) : null;
        const ctx = key => ({ refind: refindBy(key), pick: (fld, value, options) => pick(fld, value, options) });
        const fillAll = async list => {
          // 先填单选/勾选：它们会让别的字段出现或消失（如勾“至今”后结束时间消失）。
          list.sort((a, b) => (/radio|checkbox/.test(b.kind) ? 1 : 0) - (/radio|checkbox/.test(a.kind) ? 1 : 0));
          for (const f of list) {
            if (cancelled) break;
            attempted.add(f.key);
            const v = values[f.key];
            const entry = { key: f.key, label: f.label, section: f.section, required: f.required, source: source[f.key] };
            const cur = refindBy(f.key)();
            if (!cur) { results.push({ ...entry, state: 'gone' }); emit({ done: report.done + 1 }); continue; } // 被前面的选择隐藏了（如勾“至今”后的结束时间）
            if ((v == null || v === '') && offline.has(f.key)) { results.push({ ...entry, state: 'fail', reason: 'AI 不可用，本地规则认不出这个问题，请手动填写' }); emit({ done: report.done + 1 }); continue; }
            if (v == null || v === '') { results.push({ ...entry, state: 'nodata' }); emit({ done: report.done + 1 }); continue; }
            if (cur.value && ((!overwrite && !fix.has(f.key)) || matches(cur, cur.value, v))) { results.push({ ...entry, state: 'kept' }); emit({ done: report.done + 1 }); continue; }
            emit({ status: `填写：${f.section ? f.section + ' / ' : ''}${f.label}` });
            const t0 = performance.now();
            const r = await fill(cur, v, ctx(f.key));
            console.debug(`[网申助手] 控件 ${f.kind} ${Math.round(performance.now() - t0)}ms ${r.ok ? "ok" : "需手动处理"}`);
            results.push(r.ok ? { ...entry, state: 'ok', value: r.actual, want: v } : { ...entry, state: 'fail', value: v, reason: r.reason });
            emit({ done: report.done + 1, results });
          }
        };
        await fillAll(todo.filter(f => !later.has(f.key)));
        if (cancelled || !later.size) continue;
        if (aiJob) {
          emit({ status: `AI 正在理解剩下的 ${aiFields.length} 个字段…` });
          const res = await aiJob;
          if (res?.error) emit({ warning: res.error });
          Object.assign(values, res?.values || {});
          Object.assign(source, res?.source || {});
          for (const k of res?.offline || []) offline.add(k);
        }
        const rest = todo.filter(f => later.has(f.key));
        // 下拉框 AI 没把握时：展开读出全部选项，带着选项再问一次。
        // AI 连不上时不再展开下拉读选项（读了也问不了 AI，只会白白开合一遍）。
        const blind = rest.filter(f => f.kind === 'select' && !f.options?.length && (split.has(f.key) || (values[f.key] == null && !offline.has(f.key))));
        if (blind.length && !cancelled) {
          emit({ status: `读取 ${blind.length} 个下拉框的选项…` });
          const withOpts = [];
          for (const f of blind) {
            const cur = refindBy(f.key)();
            if (!cur) continue;
            const options = await readOptions(cur);
            if (options.length) withOpts.push({ ...plain(cur), options });
          }
          if (withOpts.length) {
            const again = await send({ type: 'RESOLVE', fields: withOpts, page });
            Object.assign(values, again?.values || {});
            Object.assign(source, again?.source || {});
            for (const k of again?.offline || []) offline.add(k);
          }
        }
        await fillAll(rest);
      }
      // 复核：后面的操作可能触发整块重渲染，把前面填好的值冲掉。丢了的重填一次。
      if (!cancelled) {
        emit({ status: '复核已填写的字段…' });
        await settle(150, 1000);
        const now = new Map(scan().map(f => [f.key, f]));
        for (const r of results.filter(x => x.state === 'ok')) {
          const f = now.get(r.key);
          if (!f || matches(f, f.value, r.want) || matches(f, f.value, r.value)) continue;
          const again = await fill(f, r.want, { refind: refindBy(r.key), pick: (fld, value, options) => pick(fld, value, options) });
          await settle(150, 800);
          const check = refindBy(r.key)();
          if (!again.ok || !check || !matches(check, check.value, r.want)) Object.assign(r, { state: 'fail', reason: '填写后被网页清空，请手动填写' });
        }
      }
      if (!cancelled) {
        const extras = extraRows(state.profile || {});
        // 多出来的条目里的“无资料”不再逐项列出，只提示整条删除。
        const extraFrom = new Map(extras.map(x => [x.section, Number(x.key?.split('|')[2] ?? 1e9)]));
        for (let i = results.length - 1; i >= 0; i--) {
          const r = results[i], from = extraFrom.get(r.section);
          if (from != null && r.state === 'nodata' && Number(r.key.split('|')[2]) >= from) results.splice(i, 1);
        }
        results.push(...extras);
      }
      const ok = results.filter(r => r.state === 'ok').length, bad = results.filter(r => r.state === 'fail').length;
      const nodata = results.filter(r => r.state === 'nodata').length;
      emit({ status: cancelled ? '已停止' : `完成：填写 ${ok} 项，失败 ${bad} 项，无资料 ${nodata} 项`, results });
    } catch (e) {
      emit({ status: '出错：' + (e.message || e), results });
    } finally {
      running = false;
      baseline = snapshot();
      emit({ running: false, edits: [] });
      mark();
    }
    return report;
  }

  async function pick(f, value, options) {
    if (!options.length) return -1;
    const r = await send({ type: 'PICK', field: plain(f), value, options: options.slice(0, 300) });
    return Number.isInteger(r?.index) ? r.index : -1;
  }

  // ---------- 标出需要人工处理的字段 ----------
  function mark() {
    dom.all(document, '[data-af-mark]').forEach(el => { el.style.outline = el.dataset.afMark === '-' ? '' : el.dataset.afMark; el.removeAttribute('data-af-mark'); });
    const bad = new Set(report.results.filter(r => r.state === 'fail' || (r.state === 'nodata' && r.required)).map(r => r.key));
    for (const f of scan()) {
      if (!bad.has(f.key) || f.value) continue;
      f.el.dataset.afMark = f.el.style.outline || '-';
      f.el.style.outline = '2px dashed #f59e0b';
    }
  }
  function focus(key) {
    const f = scan().find(x => x.key === key);
    if (!f) return false;
    f.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = f.el.style.boxShadow;
    f.el.style.boxShadow = '0 0 0 3px rgba(37,99,235,.6)';
    setTimeout(() => { f.el.style.boxShadow = prev; }, 1600);
    return true;
  }

  // ---------- 学习：找出用户手动改过的字段 ----------
  const snapshot = () => new Map(scan().map(f => [f.key, f.value]));
  const norm2 = v => norm(String(v || ''));
  function edits() {
    if (!baseline) return [];
    // 只算真正的人工修改：和填写后的基准不同，而且也不是插件刚填进去的值（网页显示可能稍晚才更新）。
    const ours = new Map(report.results.filter(r => r.state === 'ok').map(r => [r.key, [norm2(r.value), norm2(r.want)]]));
    const list = scan().filter(f => f.value && f.kind !== 'file' && baseline.get(f.key) !== f.value && !(ours.get(f.key) || []).includes(norm2(f.value)));
    console.debug('[网申助手] 人工修改项数', list.length);
    return list.map(f => ({ ...plain(f), value: f.value }));
  }
  let editTimer = 0;
  for (const type of ['change', 'input', 'click', 'keyup']) {
    document.addEventListener(type, e => {
      if (!e.isTrusted || running || dom.closest(e.target, '#' + AF.scan.PANEL_ID)) return;
      clearTimeout(editTimer);
      editTimer = setTimeout(() => { if (!baseline) return; const list = edits(); emit({ edits: list }); }, 900);
    }, true);
  }
  async function learn() {
    const list = edits();
    if (!list.length) return 0;
    const r = await send({ type: 'LEARN', items: list, page: { host: location.host, path: location.pathname, search: location.search } });
    baseline = snapshot();
    emit({ edits: [] });
    return r?.saved || 0;
  }
  function ensureBaseline() { if (!baseline) baseline = snapshot(); }

  // ---------- 简历 / 证件照上传 ----------
  const PHOTO = /照片|证件照|头像|免冠|生活照|photo|avatar/i;
  async function toFile(type) {
    const r = await send({ type });
    if (!r?.base64) return null;
    const bin = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
    return new File([bin], r.name, { type: r.mime });
  }
  async function uploadResume() {
    const files = scan().filter(f => f.kind === 'file');
    if (!files.length) return { ok: false, reason: '页面上没有找到上传框' };
    const isPhoto = f => PHOTO.test(f.label + f.section) || (/^image\//.test(f.input.accept || '') && !/pdf|doc/.test(f.input.accept || ''));
    const photoField = files.find(isPhoto);
    const resumeField = files.find(f => f !== photoField && /简历|附件|resume|cv/i.test(f.label + f.section + (f.input.accept || '')))
      || files.find(f => f !== photoField);
    const done = [];
    if (resumeField) { const file = await toFile('RESUME'); if (file) { await fillFile(resumeField, file); done.push('简历'); } }
    if (photoField) { const file = await toFile('PHOTO'); if (file) { await fillFile(photoField, file); done.push('证件照'); } }
    return done.length ? { ok: true, actual: done.join('、') } : { ok: false, reason: '还没有保存简历/证件照文件，请在设置页上传' };
  }

  AF.domEngine = {
    expandRows, extraRows,
    run, learn, focus, uploadResume, ensureBaseline, edits,
    cancel: () => { cancelled = true; },
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    get report() { return report; }, get running() { return running; },
    send,
  };
})();
