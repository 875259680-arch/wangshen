// 页面右下角的小面板（Shadow DOM，不受网站样式影响）。只在顶层页面显示。
(() => {
  if (globalThis.AF?.panel) return;
  const AF = globalThis.AF;
  const { engine } = AF;
  const top = window === window.top;
  AF.panel = {};

  // iframe 里的表单：由后台转发指令，在本帧执行，结果汇报给顶层面板。
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === 'RUN' && (!top || msg.fromCommand)) {
      // 同源隐藏 iframe 常是日历/上传工具；它们内部仍有 input，不能据此当成申请表。
      if (!top && window.frameElement) {
        const frame = window.frameElement, box = frame.getBoundingClientRect();
        if (!AF.util.visible(frame) || (box.right < -1000 && box.bottom < -1000)) { reply({ skipped: true, results: [] }); return; }
      }
      if (!top && !AF.scan.scan().filter(f => f.kind !== 'file').length) { reply({ skipped: true }); return; }
      if (top) { show(true); start(); reply({}); return; }
      // 等本帧真正结束后才回复；顶层会收齐各帧报告，避免迟到结果覆盖下一轮。
      engine.run(msg.opts).then(r => reply({ results: r.results, status: r.status }));
      return true;
    }
    if (msg.type === 'FOCUS' && !top) { reply({ ok: engine.focus(msg.key) }); return; }
    if (msg.type === 'CANCEL' && !top) { engine.cancel(); reply({}); return; }
    if (msg.type === 'SHOW' && top) { show(true); reply({}); }
  });
  if (!top) return;

  let host, root, frameResults = [], framesRunning = false, runSerial = 0, opts = { overwrite: false };
  const css = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  .card{position:fixed;width:340px;min-width:300px;min-height:180px;max-height:calc(100vh - 16px);max-width:calc(100vw - 16px);resize:both;display:flex;flex-direction:column;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.14);font-size:13px;z-index:2147483647;overflow:hidden}
  .head{display:flex;align-items:center;gap:8px;padding:10px 12px 10px 14px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:14px;cursor:move;user-select:none;touch-action:none}
  .head .sp{flex:1}
  .icon{border:0;background:none;cursor:pointer;color:#6b7280;font-size:16px;line-height:1;padding:2px 6px;border-radius:6px}
  .icon:hover{background:#f3f4f6}
  .body{padding:12px 14px;overflow:auto;display:flex;flex-direction:column;gap:10px;flex:1;min-height:0}
  .actions{display:grid;grid-template-columns:1fr auto;gap:8px}
  .actions .btn{width:auto;white-space:nowrap}
  .btn{width:100%;border:1px solid #d1d5db;background:#fff;border-radius:9px;padding:9px 10px;font-size:14px;cursor:pointer;color:#111827}
  .btn:hover{background:#f9fafb}
  .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600}
  .btn.primary:hover{background:#1d4ed8}
  .btn:disabled{opacity:.6;cursor:default}
  .row{display:flex;gap:8px}
  .opt{display:flex;align-items:center;gap:6px;color:#4b5563;font-size:12px;cursor:pointer}
  .bar{height:4px;background:#eef2ff;border-radius:4px;overflow:hidden}
  .bar i{display:block;height:100%;background:#2563eb;width:0;transition:width .2s}
  .status{color:#374151;line-height:1.5}
  .warn{color:#b45309;font-size:12px}
  .chips{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .chip{text-align:center;white-space:nowrap}
  .chip{padding:2px 8px;border-radius:999px;font-size:12px;background:#f3f4f6;color:#374151}
  .chip.ok{background:#ecfdf5;color:#047857}.chip.fail{background:#fef2f2;color:#b91c1c}.chip.nodata{background:#fffbeb;color:#b45309}
  .list{display:flex;flex-direction:column;gap:4px}
  .item{display:grid;grid-template-columns:6px minmax(64px,auto) 1fr;gap:8px;align-items:baseline;padding:6px 8px;border-radius:8px;background:#f9fafb;cursor:pointer;line-height:1.4}
  .item .lab{white-space:nowrap}
  .item .why{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .item:hover{background:#eff6ff}
  .item b{font-weight:600}
  .item .why{color:#6b7280;font-size:12px}
  .dot{width:6px;height:6px;border-radius:50%;flex:none;transform:translateY(-1px)}
  .dot.fail,.dot.extra{background:#ef4444}.dot.nodata{background:#f59e0b}.dot.diff{background:#8b5cf6}
  .learn{display:flex;align-items:center;gap:8px;background:#eff6ff;border-radius:9px;padding:8px 10px;color:#1e3a8a}
  .learn .sp{flex:1}
  .learn button{border:0;background:#2563eb;color:#fff;border-radius:7px;padding:5px 10px;cursor:pointer}
  .foot{padding:8px 14px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;color:#6b7280;font-size:12px}
  .foot a{color:#2563eb;cursor:pointer;text-decoration:none}
  .bubble{position:fixed;right:20px;bottom:20px;width:48px;height:48px;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;cursor:grab;touch-action:none;user-select:none;box-shadow:0 8px 20px rgba(37,99,235,.35);z-index:2147483647;border:0}
  .sec{font-size:12px;color:#6b7280;margin-top:2px}
  .tabs{display:flex;gap:4px;border-bottom:1px solid #eef2f7}
  .tab{border:0;background:none;padding:6px 10px;cursor:pointer;color:#6b7280;font-size:13px;border-bottom:2px solid transparent;margin-bottom:-1px}
  .tab.on{color:#2563eb;border-color:#2563eb;font-weight:600}.tab:disabled{opacity:.45;cursor:default}
  .learnall{display:flex;align-items:center;justify-content:space-between;color:#6b7280;font-size:12px}
  .chg{color:#374151}
  .more{color:#6b7280;font-size:12px;cursor:pointer;padding:4px 2px}.more:hover{color:#2563eb}
  .learnbox{display:flex;flex-direction:column;gap:4px}
  .litem{display:flex;gap:6px;align-items:center;padding:6px 8px;border-radius:8px;background:#f8fafc;line-height:1.4}
  .litem .ltext{flex:1;min-width:0;word-break:break-all}
  .litem .why{color:#6b7280;font-size:12px}
  .mini{border:0;background:#2563eb;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;flex:none}
  .mini.ghost{background:#e5e7eb;color:#374151}
  `;

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  }

  const uiKey = 'af-ui:' + location.host;
  let expanded = false;
  try { expanded = localStorage.getItem(uiKey) === 'open'; } catch (_) {}

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = AF.scan.PANEL_ID;
    root = host.attachShadow({ mode: 'open' });
    root.append(el('style', {}, css), el('div', { id: 'wrap' }));
    document.documentElement.append(host);
    engine.subscribe(render);
    render(engine.report);
  }
  function show(open) {
    mount();
    if (open != null) { expanded = open; try { localStorage.setItem(uiKey, open ? 'open' : 'closed'); } catch (_) {} }
    render(engine.report);
  }

  async function start() {
    if (engine.running || framesRunning) return;
    engine.ensureBaseline();
    frameResults = []; framesRunning = true;
    const runId = ++runSerial;
    const children = engine.send({ type: 'RUN_FRAMES', opts, runId });
    await engine.run(opts);
    render(engine.report);
    const r = await children;
    if (runId !== runSerial) return;
    frameResults = (r?.reports || []).flatMap(fr => fr.results.map(x => ({ ...x, frameId: fr.frameId })));
    if (r?.error) frameResults.push({ state: 'fail', label: '内嵌页面', reason: '无法检查内嵌页面，请手动处理' });
    framesRunning = false;
    render(engine.report);
  }

  // 面板位置、大小记在本机（每个浏览器一份），拖动和缩放后保留；卡片只建一次，进度刷新只换内容，拖到一半不会被重建打断。
  const GEOM = 'af-panel-geom';
  const SIZES = { small: 340, large: 560 };
  let geom = null, card = null, bodyEl = null, sizeBtn = null;
  try { geom = JSON.parse(localStorage.getItem(GEOM) || 'null'); } catch (_) {}
  const saveGeom = () => { try { localStorage.setItem(GEOM, JSON.stringify(geom)); } catch (_) {} };
  // 夹在视口里：窗口变小或换显示器后不会跑到屏幕外面
  function place() {
    if (!card) return;
    const w = Math.min(geom?.w || SIZES.small, innerWidth - 16), h = Math.min(geom?.h || 0, innerHeight - 16);
    card.style.width = w + 'px';
    card.style.height = h ? h + 'px' : '';
    const x = geom?.x ?? innerWidth - w - 20, y = geom?.y ?? null;
    card.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    if (y == null) { card.style.top = ''; card.style.bottom = '20px'; }
    else { card.style.bottom = ''; card.style.top = Math.max(8, Math.min(y, innerHeight - 60)) + 'px'; }
    if (sizeBtn) sizeBtn.textContent = w >= SIZES.large - 20 ? '⤡' : '⤢';
  }
  addEventListener('resize', place);
  function buildCard() {
    const head = el('div', { class: 'head', title: '按住拖动' }, '网申助手', el('span', { class: 'sp' }),
      sizeBtn = el('button', { class: 'icon', title: '大 / 小窗口', onclick: () => { const big = (geom?.w || SIZES.small) < SIZES.large - 20; geom = { ...geom, w: big ? SIZES.large : SIZES.small, h: 0 }; saveGeom(); place(); } }, '⤢'),
      el('button', { class: 'icon', title: '收起', onclick: () => show(false) }, '–'));
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = card.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      const move = ev => { geom = { ...geom, x: ev.clientX - dx, y: ev.clientY - dy }; place(); };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); saveGeom(); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    bodyEl = el('div', { class: 'body' });
    const foot = el('div', { class: 'foot' },
      el('span', {}, 'Alt+Shift+F 快速填写'),
      el('span', {},
        el('a', { title: '把填不上的字段（不含你的资料）导出成文件，发给开发者补适配', onclick: exportDiag }, '导出诊断'), ' · ',
        el('a', { onclick: () => engine.send({ type: 'OPEN_OPTIONS' }) }, '资料与设置')));
    card = el('div', { class: 'card' }, head, bodyEl, foot);
    // 右下角拖拽缩放（CSS resize），松手后记住大小
    new ResizeObserver(() => {
      if (!card.isConnected) return;
      const r = card.getBoundingClientRect();
      if (Math.abs(r.width - (geom?.w || 0)) > 2 || (geom?.h && Math.abs(r.height - geom.h) > 2) || (!geom?.h && card.style.height)) {
        geom = { ...geom, w: Math.round(r.width), h: card.style.height ? Math.round(r.height) : 0 }; saveGeom();
      }
    }).observe(card);
    place();
  }

  // 收起后的小球：按住能拖到任何地方（挡住网页按钮时挪开），位置记在本机；只点一下不拖才展开
  const BUBBLE = 'af-bubble-pos';
  let bubble = null, bpos = null;
  try { bpos = JSON.parse(localStorage.getItem(BUBBLE) || 'null'); } catch (_) {}
  function placeBubble() {
    if (!bubble || !bpos) return;
    bubble.style.right = 'auto'; bubble.style.bottom = 'auto';
    bubble.style.left = Math.max(4, Math.min(bpos.x, innerWidth - 52)) + 'px';
    bubble.style.top = Math.max(4, Math.min(bpos.y, innerHeight - 52)) + 'px';
  }
  addEventListener('resize', placeBubble);
  function buildBubble() {
    const b = el('button', { class: 'bubble', title: '网申助手（按住可拖动）' }, '申');
    b.addEventListener('pointerdown', e => {
      const r = b.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
      let dragged = false;
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
      const move = ev => {
        if (!dragged && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        dragged = true; bpos = { x: ev.clientX - dx, y: ev.clientY - dy }; placeBubble();
      };
      const up = () => {
        b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up);
        if (dragged) { try { localStorage.setItem(BUBBLE, JSON.stringify(bpos)); } catch (_) {} } else show(true);
      };
      b.addEventListener('pointermove', move); b.addEventListener('pointerup', up);
    });
    return b;
  }

  let tab = 'todo';   // 下方列表：待处理 / 可学习
  function render(r) {
    if (!root) return;
    const wrap = root.getElementById('wrap');
    if (!expanded) {
      if (!bubble) bubble = buildBubble();
      if (bubble.parentNode !== wrap) { wrap.replaceChildren(bubble); placeBubble(); }
      return;
    }
    if (!card) buildCard();
    if (card.parentNode !== wrap) { wrap.replaceChildren(card); place(); }
    const results = [...(r.results || []), ...frameResults];
    const count = s => results.filter(x => x.state === s).length;
    const rank = x => (x.state === 'extra' ? 3 : x.state === 'fail' ? 2 : x.state === 'diff' ? 1.5 : 0) + (x.required ? 1 : 0);
    const todo = results.filter(x => ['fail', 'nodata', 'extra', 'diff'].includes(x.state)).sort((a, b) => rank(b) - rank(a));
    const edits = r.edits || [];
    const busy = r.running || framesRunning;
    const pct = r.total ? Math.round(100 * r.done / r.total) : (r.running ? 5 : 0);
    const done = !busy && /^完成/.test(r.status || '');
    const summary = done
      ? `已填 ${count('ok')} 项 · 待你处理 ${todo.length} 项${count('kept') ? ` · 原有 ${count('kept')} 项` : ''}${r.elapsed ? ` · ${r.elapsed} 秒` : ''}`
      : framesRunning && !r.running ? '等待内嵌页面完成…' : r.status || '';
    if (tab === 'learn' && !edits.length) tab = 'todo';
    if (edits.length && !todo.length) tab = 'learn';
    const why = x => (x.state === 'nodata' ? x.reason || '资料里没有' : x.reason) || '';

    // replaceChildren 遇到 null 会写出“null”字样（3.0 面板的 bug），先滤掉
    const parts = [
      el('div', { class: 'actions' },
        busy
          ? el('button', { class: 'btn', onclick: () => { engine.cancel(); engine.send({ type: 'CANCEL_FRAMES' }); } }, '停止')
          : el('button', { class: 'btn primary', onclick: start }, results.length ? '再填一次' : '一键填写'),
        el('button', { class: 'btn', disabled: busy, title: '按上传框名称匹配“资料与设置 → 材料”里的文件', onclick: async () => {
          const res = await engine.uploadResume();
          engine.report.status = res.ok ? `已上传：${res.actual}` : res.reason;
          render(engine.report);
        } }, '上传材料')),
      el('label', { class: 'opt', title: '不勾时只填空着的格子' },
        el('input', { type: 'checkbox', checked: opts.overwrite, onchange: e => { opts.overwrite = e.target.checked; } }), '覆盖网页上已有的内容'),
      busy ? el('div', { class: 'bar' }, Object.assign(el('i'), { style: `width:${pct}%` })) : null,
      summary ? el('div', { class: 'status' }, summary) : null,
      /扩展已更新|Extension context invalidated/i.test(r.status || '') ? el('button', { class: 'mini', onclick: () => location.reload() }, '刷新页面重连') : null,
      r.warning ? el('div', { class: 'warn' }, r.warning) : null,
      (todo.length || edits.length) ? el('div', { class: 'tabs' },
        el('button', { class: 'tab' + (tab === 'todo' ? ' on' : ''), onclick: () => { tab = 'todo'; render(engine.report); } }, `待处理 ${todo.length}`),
        el('button', { class: 'tab' + (tab === 'learn' ? ' on' : ''), disabled: !edits.length, onclick: () => { tab = 'learn'; render(engine.report); } }, `可学习 ${edits.length}`)) : null,
      tab === 'todo' && todo.length ? todoList(todo, why) : null,
      tab === 'learn' && edits.length ? learnBox(edits) : null,
    ].filter(Boolean);
    bodyEl.replaceChildren(...parts);
  }

  // 待处理：必填的、失败的逐条列；选填又资料里没有的（论文、推荐码……）合成一行，点开再看
  let showOptional = false;
  function todoList(todo, why) {
    const row = x => el('div', { class: 'item', title: `${x.section ? x.section + ' · ' : ''}${x.label}：${why(x)}（点击定位）`, onclick: () => x.frameId ? engine.send({ type: 'FRAME_FOCUS', frameId: x.frameId, key: x.key }) : engine.focus(x.key) },
      el('span', { class: 'dot ' + x.state }),
      el('b', { class: 'lab' }, x.label + (x.required ? ' *' : '')),
      el('span', { class: 'why' }, why(x)));
    const must = todo.filter(x => x.state !== 'nodata' || x.required), optional = todo.filter(x => x.state === 'nodata' && !x.required);
    const diffs = todo.filter(x => x.state === 'diff');
    return el('div', { class: 'list' },
      diffs.length ? el('div', { class: 'learnall' }, el('span', {}, `${diffs.length} 项网页上的值和资料不一致`),
        el('button', { class: 'mini', disabled: engine.running, title: '只改这几项，其它不动', onclick: async () => { await engine.fixDiffs(diffs.map(x => x.key)); render(engine.report); } }, '用资料覆盖')) : null,
      ...must.slice(0, 60).map(row),
      optional.length ? el('div', { class: 'more', onclick: () => { showOptional = !showOptional; render(engine.report); } },
        `${showOptional ? '▾' : '▸'} 选填、资料里没有的 ${optional.length} 项`) : null,
      ...(showOptional ? optional.slice(0, 80).map(row) : []));
  }

  // 手动修改逐条确认：每条一行“问题  原来 → 现在”，下面一行小字写会记成什么规则；记住 / 忽略 各一个按钮。
  function learnBox(edits) {
    const say = n => { engine.report.status = `已记住 ${n} 项，下次自动填写`; render(engine.report); };
    if (engine.mode !== 'platform') {
      return el('div', { class: 'learn' }, `你手动填了 ${edits.length} 项`, el('span', { class: 'sp' }),
        el('button', { class: 'mini', onclick: async () => say(await engine.learn()) }, '全部记住'));
    }
    const rule = x => !x.learnable ? x.why : x.city ? `把“${x.after.split('/').pop()}”加进意向城市优先级`
      : x.fill && x.kind !== 'select' ? `资料里这项是空的：补进资料（所有网站通用）`
      : x.from != null ? `资料是“${x.from}”时，这里填“${x.after}”` : `这个问题以后填“${x.after}”`;
    return el('div', { class: 'list' },
      edits.some(x => x.learnable) ? el('div', { class: 'learnall' }, el('span', {}, '确认无误的逐条“记住”，或'),
        el('button', { class: 'mini', onclick: async () => say(await engine.learn()) }, '全部记住')) : null,
      ...edits.slice(0, 40).map(x => el('div', { class: 'litem' },
        el('div', { class: 'ltext' },
          el('div', {}, el('b', {}, x.label), el('span', { class: 'chg' }, x.before ? `  ${x.before} → ${x.after}` : `  ${x.after}`)),
          el('div', { class: 'why' }, rule(x))),
        x.learnable ? el('button', { class: 'mini', onclick: async () => say(await engine.learn([x])) }, '记住') : null,
        el('button', { class: 'mini ghost', onclick: () => engine.ignore(x) }, '忽略'))).filter(Boolean));
  }

  async function exportDiag() {
    const d = await engine.exportDiag();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
    a.download = `网申助手诊断-${new Date().toISOString().slice(0, 10)}.json`;
    root.append(a); a.click(); a.remove();
    engine.report.status = `已导出诊断（${d?.items?.length || 0} 条）`;
    render(engine.report);
  }

  // 有表单才出现：页面上有 4 个以上输入控件时显示一个小圆按钮。
  let tries = 0;
  const probe = () => {
    // 探测出错（网站改了 DOM 结构等）不能让小球永远不出来：记下来、照常重试
    try { probe0(); } catch (e) { AF.panelError = String(e?.message || e); if (++tries < 40) setTimeout(probe, 3000); }
  };
  const probe0 = () => {
    if (host?.isConnected) return;
    const n = AF.util.dom.all(document, 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select').length;
    // 认得的招聘网站直接出小球：51job 新版简历页要先点卡片的“编辑”才有输入框，以前要等到那时才看得见插件
    const known = /(^|\.)(zhiye\.com|mokahr\.com|hotjob\.cn|jobs\.feishu\.cn|51job\.com)$/.test(location.hostname) && top;
    if (n >= 4 || known || document.querySelector('iframe')) { show(); return; }
    if (++tries < 40) setTimeout(probe, 3000);
  };
  setTimeout(probe, 1200);
  // 有的网站（51job 新版是 Nuxt）加载完会整页重渲染，把挂在页面上的面板一起清掉：被清掉就挂回去
  setInterval(() => { if (host && !host.isConnected) document.documentElement.append(host); }, 1500);
  // 开发用：本机开发页（127.0.0.1:8765）上派发 af:dev-reload 事件 → 后台重载插件，改完代码不用手点“重新加载”
  if (location.origin === 'http://127.0.0.1:8765') {
    document.addEventListener('af:dev-reload', () => chrome.runtime.sendMessage({ type: 'DEV_RELOAD' }, r => {
      document.documentElement.dataset.afReload = JSON.stringify(r || { error: chrome.runtime.lastError?.message });
    }));
    document.addEventListener('af:dev-msg', e => chrome.runtime.sendMessage(JSON.parse(e.detail), r => {
      document.dispatchEvent(new CustomEvent('af:dev-reply', { detail: JSON.stringify(r ?? { error: chrome.runtime.lastError?.message }) }));
    }));
    document.documentElement.dataset.afDev = chrome.runtime.getManifest().version;
  }
  AF.panel = { show };
})();
