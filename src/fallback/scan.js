// 扫描：把页面上的表单整理成「段落 / 问题 / 第几条 / 控件类型 / 当前值」。
// 不保存 DOM 节点引用给后续使用——每次操作前都重新扫描，用 key 找回控件，
// 这样页面重渲染、条件字段出现/消失都不会让执行器拿着失效节点。
(() => {
  if (globalThis.AF?.scan) return;
  const AF = globalThis.AF;
  const { clean, norm, text, visible, isPlaceholder } = AF.util;
  const { dom } = AF.util;

  const PANEL_ID = 'af-panel-host';
  // 弹层：下拉菜单、日期面板、气泡。这里的输入框和文字不属于表单本身。
  const POPUP = [
    '[role=listbox]', '[role=menu]', '[role=dialog][class*=picker]', '[role=tooltip]',
    '[class*=dropdown]:not([class*=dropdown-trigger])', '[class*=popper]', '[class*=popover]',
    '[class*=picker-panel]', '[class*=picker-dropdown]', '[class*=cascader-menu]', '[class*=Menu-container]',
  ].join(',');
  const WIDGET = /(^|[-_])(select|cascader|picker|combobox|date-?editor|date-?picker|time-?picker|range-?editor)([-_]|$)/i;
  const DATEISH = /date|time|calendar|month|year|picker-range|range-editor/i;
  const DATE_PH = /日期|时间|年月|年份|月份|起止|开始|结束|yyyy|date|month|year/i;
  const NOISE = /(^|[-_])(error|explain|feedback|tip|tips|help|message|count|counter|limit|suffix|extra|button|btn)([-_]|$)/i;
  // 常见段落名：样式拿不到时（或网站标题不加粗）也能认出段落。
  const SECTION_NAME = /^(个人|基本|基础|教育|学习|实习|工作|职业|项目|校园|在校|学生|社会实践|实践|家庭|获奖|荣誉|奖惩|证书|资格|技能|语言|外语|自我|其他|其它|附加|补充|求职|培训|论文|科研|专利|发表|兴趣|紧急)[\u4e00-\u9fa5]{0,6}(信息|经历|背景|经验|成员|情况|能力|评价|意向|成果|描述|奖励|证书|资料|关系|联系人|问题)$/;
  const CONSENT = /同意|已阅读|已仔细阅读|承诺|授权|隐私|声明|agree|consent|privacy|terms/i;

  const ours = el => !!dom.closest(el, '#' + PANEL_ID);
  const inPopup = el => {
    const p = dom.closest(el, POPUP);
    if (!p) return false;
    // 有些站点把整个表单项命名为 xxx-dropdown-wrapper；只有挂在 body 附近、浮在上层的才算弹层。
    const s = getComputedStyle(p);
    return s.position === 'absolute' || s.position === 'fixed' || dom.parent(p) === document.body;
  };
  const classHit = (el, re) => el.classList && [...el.classList].some(c => re.test(c));

  // 控件外壳：带 select/picker 等类名的最外层祖先。
  // 有的网站把整个“标题+控件”的表单项也叫 Select-xxx：里面有标题元素的就不是控件本体。
  function hasTitle(cur, el) {
    for (const t of dom.all(cur, '[class*=title],[class*=Title],label')) {
      if (!dom.contains(t, el) && clean(t.textContent) && !dom.closest(t, '[class*=option],[class*=Option],[role=option]')) return true;
    }
    return false;
  }
  function widgetRoot(el) {
    let root = null;
    for (let cur = el, i = 0; cur && cur !== document.body && i < 6; cur = dom.parent(cur), i++) {
      if (cur !== el && dom.all(cur, 'input:not([type=hidden]),textarea').length > 2) break;
      if (cur !== el && hasTitle(cur, el)) break;
      if (classHit(cur, WIDGET) || (cur.getAttribute('role') === 'combobox' && cur.tagName !== 'INPUT')) root = cur;
    }
    return root;
  }

  function commonAncestor(nodes) {
    if (nodes.length < 2) return dom.parent(dom.closest(nodes[0], 'label')) || dom.parent(nodes[0]);
    let a = dom.parent(nodes[0]);
    while (a && !nodes.every(n => dom.contains(a, n))) a = dom.parent(a);
    return a;
  }

  function groupOf(node) {
    for (let cur = dom.parent(node), i = 0; cur && cur !== document.body && i < 8; cur = dom.parent(cur), i++) {
      if (/^(radiogroup|group)$/.test(cur.getAttribute('role') || '') || classHit(cur, /(radio|checkbox)[-_]?group$/i)) return cur;
    }
    return null;
  }

  function choiceRoot(node) {
    const label = dom.closest(node, 'label'); if (label) return label;
    // 装饰圆点/方框也带 checkbox 类名；以前停在这个内壳，选项文字为空，勾上后回读仍是空。
    for (let el = dom.parent(node), i = 0; el && el !== document.body && i < 6; el = dom.parent(el), i++) {
      if (classHit(el, /(radio|checkbox)/i) && !classHit(el, /group/i) && text(el) && text(el).length < 80
        && dom.all(el, 'input[type=radio],input[type=checkbox]').length === 1) return el;
    }
    return dom.closest(dom.parent(node), '[class*=radio]:not([class*=group]),[class*=checkbox]:not([class*=group])') || dom.parent(node);
  }

  // ---------- 收集控件 ----------
  function collectControls() {
    const out = [];
    const taken = new Set();
    const add = (f) => { out.push(f); for (const n of f.nodes) taken.add(n); };
    const usable = el => !ours(el) && !inPopup(el);

    // 1. 自定义组件（下拉、级联、日期）——先认出外壳，内部 input 交给外壳。
    const roots = new Set();
    for (const input of dom.all(document, 'input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file])')) {
      if (!usable(input)) continue;
      const r = widgetRoot(input);
      if (r) roots.add(r);
    }
    for (const el of dom.all(document.body, 'div,span,section')) {
      if (!classHit(el, WIDGET) || dom.one(el, 'input,textarea')) continue;
      // 图标常带 picker/select 类名，但只是同一输入框的装饰；分开扫描会再执行一次错误的下拉填写。
      const shell = dom.parent(el), siblingInputs = shell ? dom.all(shell, 'input:not([type=hidden]),textarea') : [];
      if (siblingInputs.length === 1 && !hasTitle(shell, siblingInputs[0]) && usable(shell)) {
        roots.add(shell); continue;
      }
      if (dom.parent(el) && classHit(dom.parent(el), WIDGET)) continue;
      if (!usable(el) || text(el).length > 60) continue;
      roots.add(el);
    }
    // 纯 div 下拉：没有 input、没有常见类名，只有“请选择…”占位或下拉箭头。
    for (const el of dom.all(document.body, 'span,div,p,i,svg,em')) {
      const own = el.childElementCount === 0 ? clean(el.textContent) : '';
      const arrow = /^[⌄▾▼∨﹀⌵˅]$/.test(own) || (el.matches('svg,i,[class*=arrow],[class*=caret],[class*=chevron]') && el.getBoundingClientRect().width <= 24);
      const ph = /^请选择/.test(own);
      if (!arrow && !ph) continue;
      if (!usable(el) || [...roots].some(r => dom.contains(r, el))) continue;
      let box = null;
      for (let cur = dom.parent(el), i = 0; cur && cur !== document.body && i < 4; cur = dom.parent(cur), i++) {
        if (dom.one(cur, 'input,textarea,select,button')) break;
        if (cur.matches('button,a,[role=button],[role=tab],li') || text(cur).length > 40) break;
        const r = cur.getBoundingClientRect(), st = getComputedStyle(cur);
        const framed = parseFloat(st.borderBottomWidth) > 0 || parseFloat(st.borderTopWidth) > 0 || /pointer/.test(st.cursor);
        if (r.height >= 24 && r.height <= 70 && r.width >= 60 && framed) { box = cur; if (parseFloat(st.borderTopWidth) > 0) break; }
      }
      if (box && (ph || text(box) !== own) && visible(box)) roots.add(box);
    }
    for (const root of roots) {
      if ([...roots].some(o => o !== root && dom.contains(o, root))) continue;
      if (!visible(root)) continue;
      const inputs = [...dom.all(root, 'input:not([type=hidden])')].filter(i => !i.disabled);
      if (root.matches('[class*=disabled]') || dom.one(root, 'input:disabled') && !inputs.length) continue;
      const ph = inputs.map(i => i.placeholder).join(' ');
      const datey = classHit(root, DATEISH) || (!classHit(root, /select|cascader/i) && DATE_PH.test(ph));
      const kind = datey ? (inputs.length >= 2 ? 'daterange' : 'date') : 'select';
      add({ kind, el: root, input: inputs[0] || null, inputs, nodes: [root, ...inputs],
        cascader: /cascader|region|area|city|地区|省/i.test(root.className + ph) });
    }

    // 2. 单选 / 多选组
    const groups = new Map();
    const divChoices = [...dom.all(document, '[class*=radio],[class*=Radio],[class*=checkbox],[class*=Checkbox]')]
      .filter(el => !dom.one(el, 'input') && !dom.closest(el, 'label') && classHit(el, /(^|[-_])(radio|checkbox)([-_](item|option|wrapper|btn|button))?$/i)
        && !classHit(el, /group$/i) && text(el) && text(el).length <= 30
        && !(dom.parent(el) && classHit(dom.parent(el), /(^|[-_])(radio|checkbox)([-_](item|option|wrapper|btn|button))?$/i)));
    for (const node of [...dom.all(document, 'input[type=radio],input[type=checkbox],[role=radio],[role=checkbox]'), ...divChoices]) {
      if (!usable(node) || node.disabled) continue;
      // 可见的选项外壳：从 input 的父级开始找（input 自己常是透明的，类名里也带 checkbox）。
      const opt = node.matches('input') ? choiceRoot(node) : node;
      if (!visible(opt)) continue;
      const kind = node.type === 'checkbox' || node.getAttribute('role') === 'checkbox' || (!node.matches('input,[role=radio]') && /checkbox/i.test(node.className)) ? 'checkbox' : 'radio';
      const container = groupOf(node)
        || (node.name ? commonAncestor(dom.all(node.getRootNode(), `input[name="${CSS.escape(node.name)}"]`).filter(n => n.getRootNode() === node.getRootNode() && n.form === node.form)) : null)
        || (dom.one(dom.parent(opt), 'input:not([type=radio]):not([type=checkbox]),textarea,select') ? opt : dom.parent(opt));
      const gk = container;
      if (!groups.has(gk)) groups.set(gk, { kind, el: container, options: [], nodes: [container] });
      const g = groups.get(gk);
      if (!g.options.some(o => o.el === opt)) g.options.push({ el: opt, input: node.matches('input') ? node : null, text: text(opt) });
      g.nodes.push(node, opt);
    }
    for (const g of groups.values()) {
      if (g.options.length === 1 && g.kind === 'checkbox' && CONSENT.test(g.options[0].text)) continue;
      add(g);
    }

    // 3. 原生控件
    for (const el of dom.all(document, 'input,textarea,select,[contenteditable=""],[contenteditable=true]')) {
      if (taken.has(el) || !usable(el) || el.disabled || [...taken].some(t => dom.contains(t, el) && t !== document.body)) continue;
      if (el.matches('input') && /^(hidden|submit|button|reset|image|radio|checkbox|password|range|color)$/i.test(el.type)) continue;
      const vis = visible(el) || (el.type === 'file' && visible(dom.parent(el)));
      if (!vis) continue;
      let kind = 'text';
      if (el.tagName === 'TEXTAREA') kind = 'textarea';
      else if (el.tagName === 'SELECT') kind = 'native-select';
      else if (el.isContentEditable && el.tagName !== 'INPUT') kind = 'rich';
      else if (el.type === 'file') kind = 'file';
      else if (/^(date|month|datetime-local)$/.test(el.type)) kind = 'native-date';
      else if (el.readOnly && DATE_PH.test(el.placeholder)) kind = 'date';
      // 能键入、但占位符要求日期（“请选择日期”“YYYY-MM”）：走日期流程，键入后核验组件是否真的收到。
      else if (/日期|年月|yyyy|date|month/i.test(el.placeholder) && !/描述|说明|原因/.test(el.placeholder)) kind = 'date';
      else if (el.readOnly && /请选择|select/i.test(el.placeholder)) kind = 'select';
      add({ kind, el, input: el, inputs: [el], nodes: [el],
        options: kind === 'native-select' ? [...el.options].filter(o => o.value !== '' && !isPlaceholder(o.text)).map(o => ({ text: clean(o.text), value: o.value })) : undefined });
    }
    return out;
  }

  // ---------- 问题文字 ----------
  function noisy(el) {
    if (el.nodeType !== 1) return false;
    return classHit(el, NOISE) || el.matches('button,[role=button],svg,i,img,style,script');
  }
  // 节点里可以当“问题文字”的部分：跳过按钮、提示、弹层、隐藏元素；含有别的控件则返回 null。
  function textOf(node, fieldNodes, own) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || noisy(node) || fieldNodes.has(node) || own.has(node)) return '';
    if (node.matches(POPUP) || inPopup(node) || !visible(node)) return '';
    if ([...own].some(f => dom.contains(node, f))) return '';
    if ([...fieldNodes].some(f => dom.contains(node, f))) return null; // 含有别的控件，不能当标签
    let out = '';
    for (const c of dom.children(node)) { const t = textOf(c, fieldNodes, own); if (t) out += ' ' + t; }
    return out;
  }
  // 两个控件之间的连接词（“2019 年 至 2023 年”），不是问题文字。
  const CONNECTOR = /^(至|到|~|～|-|—|–|to|年|月|日)$/i;
  const tidy = s => clean(s).replace(/^[*＊\s]+|[*＊:：\s]+$/g, '').replace(/^\d+\s*[.、]\s*(?=\D)/, '').slice(0, 200);

  function labelOf(f, fieldNodes) {
    if (f.kind === 'checkbox' && f.options?.length === 1 && tidy(f.options[0].text)) return { text: tidy(f.options[0].text), anchor: f.el };
    const el = f.input || f.el;
    const by =el.getAttribute?.('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map(id => text(el.getRootNode().getElementById?.(id) || document.getElementById(id))).join(' '); if (tidy(t)) return { text: tidy(t), anchor: el }; }
    if (el.id) { const l = dom.one(el.getRootNode(), `label[for="${CSS.escape(el.id)}"]`); if (l && tidy(text(l)) && !dom.contains(l, el)) return { text: tidy(text(l)), anchor: dom.parent(l) }; }
    const own = new Set(f.nodes);
    const others = new Set([...fieldNodes].filter(n => !own.has(n)));
    // 单选/多选组从第一个选项开始往外找，这样容器内部的问题文字也能找到。
    let cur = (f.kind === 'radio' || f.kind === 'checkbox') && f.options?.[0]?.el ? f.options[0].el : f.el;
    for (let i = 0; i < 8 && dom.parent(cur) && dom.parent(cur) !== document.body; i++) {
      const parent = dom.parent(cur);
      const kids = [...dom.children(parent)];
      const at = kids.indexOf(cur);
      // 先找控件前面的兄弟（最近的优先），碰到别的控件就停；再找后面的。
      for (const dir of [-1, 1]) {
        for (let j = at + dir; j >= 0 && j < kids.length; j += dir) {
          const t = textOf(kids[j], others, own);
          if (t === null) break;
          const v = tidy(t);
          if (v && /[\p{L}\p{N}]/u.test(v) && !/^\d+\s*\/\s*\d+$/.test(v) && !/^(必填|选填|required)/i.test(v) && !CONNECTOR.test(v)) return { text: v, anchor: parent };
        }
      }
      cur = parent;
    }
    const ph = el.getAttribute?.('placeholder') || el.getAttribute?.('aria-label') || text(dom.one(f.el, '[class*=placeholder]'));
    return { text: tidy(String(ph || '').replace(/^(请(输入|填写|选择)(您的|你的)?|please\s+(enter|select|input)\s*)/i, '')), anchor: dom.parent(f.el) };
  }

  // ---------- 段落标题 ----------
  function headings(labels) {
    const out = [];
    for (const el of dom.all(document.body, '*')) {
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || el.childElementCount > 3) continue;
      const t = clean(el.textContent).replace(/\s*[*＊]+$/, '');   // “教育经历*”：必填星号不算标题文字
      if (t.length < 2 || t.length > 24 || /[:：*]$/.test(t) || labels.has(norm(t)) || /\.(pdf|docx?|jpe?g|png|wps|pptx?)$/i.test(t)) continue;
      const isH = /^H[1-6]$|^LEGEND$/.test(tag) || (t.length <= 10 && SECTION_NAME.test(t));
      if (!isH) {
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
        if (!own) continue;
        const s = getComputedStyle(el);
        const fs = parseFloat(s.fontSize), fw = parseInt(s.fontWeight) || 400;
        let titled = false;
        for (let a = el, k = 0; a && k < 4; a = dom.parent(a), k++) if (classHit(a, /title|header|heading/i)) { titled = true; break; }
        if (!((fs >= 16 && fw >= 600) || fs >= 20 || (titled && (fw >= 500 || fs >= 16) && fs >= 14))) continue;
      }
      if (dom.closest(el, 'nav,[role=tablist],[role=navigation],[class*=nav],[class*=tabs],[class*=menu],[class*=anchor],[class*=steps]') || inPopup(el) || ours(el) || !visible(el)) continue;
      out.push({ el, text: t });
    }
    return out.sort((a, b) => dom.position(a.el, b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  // ---------- 读取当前值 ----------
  function readValue(f) {
    const { kind } = f;
    if (kind === 'text' || kind === 'textarea' || kind === 'native-date') return clean(f.input.value);
    if (kind === 'rich') return text(f.el);
    if (kind === 'file') return '';
    if (kind === 'native-select') {
      const o = f.el.selectedOptions?.[0];
      // value 为空的选项就是“未选择”，不管它显示“年”“月”还是“请选择”。
      return o && o.value !== '' && !isPlaceholder(o.text) ? clean(o.text) : '';
    }
    if (kind === 'radio' || kind === 'checkbox') {
      return f.options.filter(o => o.input ? o.input.checked : o.el.getAttribute('aria-checked') === 'true' || dom.one(o.el, '[aria-checked=true]')
        || classHit(o.el, /(^|[-_])(checked|is-checked|active|selected)$/i) || dom.one(o.el, '[class*=checked]:not([class*=unchecked])'))
        .map(o => o.text || (kind === 'checkbox' && f.options.length === 1 ? f.label || '已勾选' : '')).join('、');
    }
    if (kind === 'date' || kind === 'daterange') {
      const vals = f.inputs.map(i => clean(i.value)).filter(Boolean);
      return vals.length ? vals.join(' ~ ') : (f.inputs.length ? '' : valueText(f.el));
    }
    if (kind === 'select') {
      const v = f.inputs.map(i => clean(i.value)).find(Boolean);
      if (v && !isPlaceholder(v)) return v;
      return valueText(f.el, f.input?.placeholder);
    }
    return '';
  }
  function valueText(root, ph) {
    // 优先读“已选中项”元素；否则读整体文字，并去掉重复（有的组件会把选中值渲染两遍）。
    const item = [...dom.all(root, '[class*=selection-item],[class*=selected-item],[class*=single-value],[class*=display-value],[class*=selected-value]')].find(e => visible(e) && clean(e.textContent));
    let t = clean((item ? item.textContent : text(root)).replace(/[⌄˅∨▼▾▽⌵⌃^✓✔×✕]/g, ''));
    const half = t.length / 2;
    // “11”“2222”这类数字不是重复渲染。
    if (Number.isInteger(half) && half >= 2 && !/^\d+$/.test(t) && t.slice(0, half).trim() === t.slice(half).trim()) t = t.slice(0, half).trim();
    const w = t.split(' ');
    if (w.length === 2 && w[0] === w[1]) t = w[0];
    if (!t || isPlaceholder(t) || (ph && clean(ph) === t)) return '';
    const p = dom.one(root, '[class*=placeholder]');
    if (p && clean(p.textContent) === t && /transparent|hidden/.test(p.className) === false && isPlaceholder(p.textContent)) return '';
    return t;
  }

  // ---------- 主入口 ----------
  // 整页扫描很贵（大页面上百毫秒），而日期、下拉每一步核验都要“按 key 找回控件”。
  // 页面结构没变就复用上次的结构，只重新读值（输入框的 value 改变不产生 DOM 通知，必须每次现读）。
  // 纯 CSS 动画没有通知，所以复用最多 800ms。
  let memo = null, memoAt = 0, memoRev = -1, dirty = true;
  const watcher = new MutationObserver(() => { dirty = true; });
  watcher.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  function scan() {
    dom.sync();
    if (watcher.takeRecords().length) dirty = true;
    if (!dirty && memo && memoRev === dom.revision && performance.now() - memoAt < 800 && memo.every(f => f.el.isConnected)) {
      return memo.map(f => ({ ...f, value: readValue(f) }));
    }
    const out = scanNow();
    memo = out; memoAt = performance.now(); memoRev = dom.revision; dirty = false;
    return out.map(f => ({ ...f }));
  }
  function scanNow() {
    const fields = collectControls();
    const fieldNodes = new Set(fields.flatMap(f => f.nodes));
    const labeled = fields.map(f => ({ f, ...labelOf(f, fieldNodes) }));
    const labelSet = new Set(labeled.map(x => norm(x.text)).filter(Boolean));
    const heads = headings(labelSet);

    // 按文档顺序排序，给每个字段配上最近的前置标题。
    labeled.sort((a, b) => a.f.el === b.f.el ? 0 : (dom.position(a.f.el, b.f.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    let hi = -1;
    const counter = new Map(), partOf = new Map();
    const result = [];
    for (const x of labeled) {
      // 同意/声明/授权类勾选必须由本人操作；网站顶部的搜索框不是申请表。
      const AGREE = /已阅读|已仔细阅读|隐私|声明|协议|承诺|授权|privacy|terms|consent/i;
      if (x.f.kind === 'checkbox' && AGREE.test(x.text + ' ' + (x.f.options || []).map(o => o.text).join(' '))) continue;
      if (x.f.kind === 'radio' && AGREE.test(x.text) && !/亲属|调剂/.test(x.text)) continue;
      if (!x.text && x.f.kind !== 'file') continue; // 没有任何问题文字的控件（弹层里的搜索框等），AI 也无从判断
      const inp = x.f.input;
      // 网站顶部导航里的控件（账号菜单、搜索框）不是申请表。
      if (dom.closest(x.f.el, 'header,nav,[role=banner],[role=navigation],[class*=navbar],[class*=top-bar],[class*=topbar]') || (x.f.el.getBoundingClientRect().top + scrollY < 90 && dom.closest(x.f.el, '[class*=header],[class*=Header]'))) continue;
      if (inp && x.f.kind === 'text' && (inp.type === 'search' || /搜索|关键字|关键词|search/i.test(inp.placeholder || '') || dom.closest(x.f.el, 'header,nav,[role=banner],[role=search],[role=navigation]'))) continue;
      while (hi + 1 < heads.length && (dom.position(heads[hi + 1].el, x.f.el) & Node.DOCUMENT_POSITION_FOLLOWING) && !dom.contains(heads[hi + 1].el, x.f.el)) hi++;
      const section = hi >= 0 ? heads[hi].text : '';
      const label = x.text || '(无标题)';
      // 同一个标签容器下的多个控件（如“起止时间”的两个框）用 part 区分。
      const pk = x.anchor;
      const parts = partOf.get(pk) || [];
      const part = parts.filter(p => p === label).length;
      parts.push(label); partOf.set(pk, parts);
      // 第几条：段落里第一个问题再次出现、或同一条里问题重复，就是新的一条。
      // 不按“同名问题出现第几次”数——条目里有条件字段（勾“至今”后结束时间消失）时那样会整体错位。
      let st = counter.get(section);
      if (!st) { st = { first: label, row: 0, seen: new Set() }; counter.set(section, st); }
      if (part === 0 && st.seen.size && (label === st.first || st.seen.has(label))) { st.row++; st.seen.clear(); }
      if (part === 0) st.seen.add(label);
      const row = st.row;
      const f = x.f;
      const field = {
        ...f, section, label, row, part,
        key: `${norm(section)}|${norm(label)}|${row}|${part}`,
        placeholder: clean(f.input?.placeholder || ''),
        maxLength: f.input?.maxLength > 0 && f.input.maxLength < 100000 ? f.input.maxLength : undefined,
        required: /[*＊]/.test(text(x.anchor)?.slice(0, 3) || '') || f.input?.required || f.input?.getAttribute?.('aria-required') === 'true',
      };
      // 有些日期框可输入却没有占位符，按普通文本写会只留下文字而没有提交日期模型。
      // 用明确的日期问题识别；“出生地”“毕业学校”不能仅因包含出生、毕业就当成日期。
      if ((field.kind === 'text' || field.kind === 'select' && field.input?.readOnly) && field.input) {
        const dateLabel = /日期|年月|生日|出生时间|(?:开始|结束|入学|毕业|入职|离职|发证|获奖|起止)(?:时间|月份|年份)/.test(label) && !/说明|描述|原因|格式|祝福/.test(label);
        if (dateLabel) field.kind = 'date';
        else if (field.input.readOnly) field.kind = 'select';
      }
      field.value = readValue(field);
      result.push(field);
    }
    // 同一问题下相邻的两个日期框（开始/结束）合成一个范围字段，在同一个日历面板上依次点选。
    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i], b = result[i + 1];
      if (a.kind === 'date' && b.kind === 'date' && a.label === b.label && a.section === b.section && a.row === b.row && a.part === 0 && b.part === 1) {
        let box = dom.parent(a.el);
        while (box && !dom.contains(box, b.el)) box = dom.parent(box);
        if (box && result.filter(x => dom.contains(box, x.el)).length === 2) {
          result.splice(i, 2, { ...a, kind: 'daterange', inputs: [a.input, b.input], nodes: [...a.nodes, ...b.nodes], value: [a.value, b.value].filter(Boolean).join(' ~ ') });
        }
      }
    }
    return result;
  }

  // 给 AI / 存储用的纯数据版本。
  const plain = f => ({
    key: f.key, section: f.section, label: f.label, kind: f.kind, row: f.row, part: f.part,
    placeholder: f.placeholder || undefined, maxLength: f.maxLength, required: f.required || undefined,
    options: f.options?.map(o => o.text).filter(Boolean), value: f.value || undefined,
  });

  AF.scan = { scan, readValue, plain, headings, PANEL_ID, inPopup, POPUP };
})();
