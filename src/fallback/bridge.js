// 主环境桥：运行在网页自己的 JS 环境（manifest 里 world: MAIN），因为只有这里能看到 React/Vue 组件实例。
// 内容脚本给目标 input 打上 data-af-bridge 标记并派发 af:bridge 事件（JSON 字符串），
// 这里找到该 input 所属的日期组件，用组件自己的取值类型（moment / dayjs / Date / 字符串）调用 onChange 或 v-model，
// 结果同步写回 <html data-af-bridge-result>。不读取、不外传任何页面数据。
(() => {
  // 旧版 Chrome/Edge（< 111）不认识 manifest 里的 world: MAIN，会把本文件当普通内容脚本运行——那里看不到页面组件。
  // 这时插入一个 <script> 让它在页面环境里再运行一次。
  if (globalThis.chrome?.runtime?.id) {
    if (document.documentElement?.hasAttribute('data-af-bridge-ready')) return;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/fallback/bridge.js');
    s.onload = () => s.remove();
    if (document.head || document.documentElement) (document.head || document.documentElement).append(s);
    else document.addEventListener('DOMContentLoaded', () => (document.head || document.documentElement).append(s), { once: true });
    return;
  }
  if (window.__afBridge) return;
  window.__afBridge = true;
  if (document.documentElement) document.documentElement.setAttribute('data-af-bridge-ready', '');

  // 主环境不能读取隔离环境传来的 DOM detail，也不能重新打开封闭根。
  // 在组件创建时保留根引用，仍原样调用浏览器方法，不改变组件的封闭模式。
  const closedRoots = new Set();
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) {
    const root = attach.call(this, options);
    if (options.mode === 'closed') closedRoots.add(root);
    return root;
  };
  function deepQuery(root, selector) {
    const found = root.querySelector(selector);
    if (found) return found;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) {
      const inner = deepQuery(el.shadowRoot, selector); if (inner) return inner;
    }
    return null;
  }
  const parent = el => el?.parentElement || el?.getRootNode?.()?.host || null;

  const pad = n => String(n).padStart(2, '0');
  const isLib = v => v && typeof v === 'object' && typeof v.clone === 'function' && typeof v.year === 'function' && typeof v.format === 'function';
  const isDateish = v => isLib(v) || v instanceof Date || (typeof v === 'string' && /^(19|20)\d{2}\D?\d{1,2}/.test(v)) || (typeof v === 'number' && v > 1e11);
  const fmtTok = (fmt, y, m, d) => fmt.replace(/YYYY|yyyy|MM|M|DD|dd|D|d/g, t => t[0].toLowerCase() === 'y' ? y : t === 'MM' ? pad(m) : t === 'M' ? m : /DD|dd/.test(t) ? pad(d) : d);

  // 按样本的类型造一个新值：库对象就克隆后改年月日；字符串保持原来的写法；时间戳返回数字。
  function make(sample, y, m, d, valueFormat) {
    if (typeof valueFormat === 'string' && valueFormat) {
      if (/^(timestamp|x)$/i.test(valueFormat)) return new Date(y, m - 1, d).getTime();
      return fmtTok(valueFormat, y, m, d);
    }
    if (isLib(sample)) return sample.clone().date(1).year(y).month(m - 1).date(d);
    if (typeof sample === 'string') {
      const r = sample.match(/^((?:19|20)\d{2})(\D*)(\d{1,2})(?:(\D*)(\d{1,2}))?(.*)$/);
      if (r) return r[5] != null ? `${y}${r[2]}${r[3].length === 2 ? pad(m) : m}${r[4]}${r[5].length === 2 ? pad(d) : d}${r[6] && /^\s*\d/.test(r[6]) ? '' : r[6]}` : `${y}${r[2]}${r[3].length === 2 ? pad(m) : m}`;
    }
    if (typeof sample === 'number') return new Date(y, m - 1, d).getTime();
    if (sample instanceof Date) return new Date(y, m - 1, d);
    return undefined;
  }
  // 页面里随便哪个日期组件的值都能当样本（同一个网站用同一个日期库）。
  function globalSample() {
    if (isLib(window.moment?.())) return window.moment();
    if (isLib(window.dayjs?.())) return window.dayjs();
    for (const inp of [...document.querySelectorAll('input')].slice(0, 400)) {
      for (let fb = fiberOf(inp), k = 0; fb && k < 25; fb = fb.return, k++) {
        const p = fb.memoizedProps || {};
        for (const v of [p.value, p.selectedValue, p.defaultPickerValue, p.pickerValue].flat()) if (isLib(v)) return v;
      }
    }
    return undefined;
  }
  const fiberOf = el => { const k = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')); return k ? el[k] : null; };

  // ---------- React ----------
  const PICKER_PROPS = ['disabledDate', 'format', 'picker', 'showTime', 'getCalendarContainer', 'getPopupContainer', 'onOpenChange', 'dateFormat', 'minDate', 'maxDate', 'selected', 'onPanelChange', 'dateRender'];
  function reactTargets(el) {
    const out = [];
    for (let fb = fiberOf(el), k = 0; fb && k < 30; fb = fb.return, k++) {
      if (typeof fb.type === 'string') continue;
      const p = fb.memoizedProps;
      if (!p || typeof p.onChange !== 'function') continue;
      const v = 'value' in p ? p.value : p.selected;
      const vOk = v == null || isDateish(v) || (Array.isArray(v) && v.every(x => x == null || isDateish(x)));
      if (!vOk) continue;
      if (!PICKER_PROPS.some(n => n in p) && !isDateish(v) && !(Array.isArray(v) && v.some(isDateish))) continue;
      out.push(p);
    }
    return out;
  }
  function reactSet(el, req) {
    const targets = reactTargets(el);
    const p = targets[req.nth];
    if (!p) return { ok: false, why: targets.length ? 'no more' : 'no react picker' };
    const cur = 'value' in p ? p.value : p.selected;
    const range = req.part >= 0 || Array.isArray(cur) || Array.isArray(p.placeholder);
    const sample = [cur].flat().find(isDateish) ?? [p.defaultValue, p.defaultPickerValue, p.pickerValue].flat().find(isDateish) ?? globalSample();
    const valueFormat = p.valueFormat || (typeof sample === 'string' && typeof p.format === 'string' ? p.format : null);
    const v = make(sample, req.y, req.m, req.d, valueFormat);
    if (v === undefined) return { ok: false, why: 'unknown value type', more: req.nth + 1 < targets.length };
    let next = v;
    if (range) { next = Array.isArray(cur) ? [...cur] : [null, null]; next[Math.max(0, req.part)] = v; }
    const str = [next].flat().map(x => isLib(x) ? x.format(typeof p.format === 'string' ? p.format : 'YYYY-MM-DD') : x instanceof Date ? `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}` : x);
    p.onChange(next, range ? str : str[0]);
    return { ok: true, via: 'react', more: req.nth + 1 < targets.length };
  }

  // ---------- Vue 3 ----------
  // 生产版 Vue 3 不在 DOM 上挂组件实例：从挂载点（#app._vnode）沿虚拟 DOM 往下找包含目标的组件链。
  function vue3Chain(target) {
    let host = null;
    for (let n = target; n; n = parent(n)) if (n._vnode && n.__vue_app__) host = n;
    if (!host) return null;
    const chain = [];
    let visits = 0;
    const walk = vnode => {
      if (!vnode || typeof vnode !== 'object' || ++visits > 40000) return false;
      const el = vnode.el;
      if (el && el.nodeType === 1 && el !== target && !el.contains(target)) return false;   // 元素不包含目标，剪枝；片段的锚点是文本/注释，不能剪
      if (vnode.component) {
        chain.push(vnode.component);
        if (walk(vnode.component.subTree)) return true;
        chain.pop();
        return false;
      }
      if (el === target) return true;
      if (Array.isArray(vnode.children)) for (const c of vnode.children) if (walk(c)) return true;
      return walk(vnode.ssContent);
    };
    return walk(host._vnode) ? chain.reverse() : null;
  }
  function vue3Targets(el) {
    const out = [];
    const parentOf = n => { for (; n; n = parent(n)) if (n.__vueParentComponent) return n.__vueParentComponent; return null; };
    const first = parentOf(el);
    const list = [];
    if (first) for (let inst = first, k = 0; inst && k < 12; inst = inst.parent, k++) list.push(inst);
    else list.push(...(vue3Chain(el) || []).slice(0, 12));
    {
      for (const inst of list) {
        const props = inst.props || {}, vp = inst.vnode?.props || {};
        if (!('modelValue' in props) || typeof vp['onUpdate:modelValue'] !== 'function' && typeof vp['onUpdate:model-value'] !== 'function') continue;
        const name = inst.type?.name || inst.type?.__name || '';
        if (/date|picker|calendar|time/i.test(name) || 'valueFormat' in props || /date|month|year|range/i.test(props.type || '')) out.push(inst);
      }
    }
    return out;
  }
  function vue3Set(el, req) {
    const targets = vue3Targets(el);
    const inst = targets[req.nth];
    if (!inst) return { ok: false, why: targets.length ? 'no more' : 'no vue3 picker' };
    const cur = inst.props.modelValue;
    const range = req.part >= 0 || Array.isArray(cur) || /range/i.test(inst.props.type || '');
    const sample = [cur].flat().find(isDateish) ?? new Date();
    const v = make(sample, req.y, req.m, req.d, inst.props.valueFormat);
    let next = v;
    if (range) { next = Array.isArray(cur) ? [...cur] : [null, null]; next[Math.max(0, req.part)] = v; }
    inst.emit('update:modelValue', next);
    inst.emit('change', next);
    return { ok: true, via: 'vue3', more: req.nth + 1 < targets.length };
  }

  // ---------- Vue 2 ----------
  function vue2Targets(el) {
    let n = el;
    while (n && !n.__vue__) n = parent(n);
    const out = [];
    for (let vm = n?.__vue__, k = 0; vm && k < 10; vm = vm.$parent, k++) {
      const name = vm.$options?.name || vm.$options?._componentTag || '';
      if (/date|picker|calendar|time/i.test(name) && vm.$props && 'value' in vm.$props) out.push(vm);
    }
    return out;
  }
  function vue2Set(el, req) {
    const targets = vue2Targets(el);
    const vm = targets[req.nth];
    if (!vm) return { ok: false, why: targets.length ? 'no more' : 'no vue2 picker' };
    const cur = vm.value;
    const range = req.part >= 0 || Array.isArray(cur) || /range/i.test(vm.type || '');
    const sample = [cur].flat().find(isDateish) ?? new Date();
    // Element UI 内部用 Date，再按 value-format 转换后 emit；有 emitInput 就交给它转换。
    const raw = make(vm.emitInput ? new Date() : sample, req.y, req.m, req.d, vm.emitInput ? null : vm.valueFormat);
    let next = raw;
    if (range) { next = Array.isArray(cur) ? [...cur] : [null, null]; next[Math.max(0, req.part)] = raw; if (vm.emitInput && next.some(x => x == null)) next = next.map(x => x ?? raw); }
    if (typeof vm.emitInput === 'function') vm.emitInput(next); else vm.$emit('input', next);
    if (typeof vm.emitChange === 'function') vm.emitChange(next); else vm.$emit('change', next);
    return { ok: true, via: 'vue2', more: req.nth + 1 < targets.length };
  }

  document.addEventListener('af:bridge', e => {
    let req;
    try { req = JSON.parse(e.detail); } catch { return; }
    const selector = `[data-af-bridge="${CSS.escape(req.id)}"]`;
    let el = deepQuery(document, selector);
    if (!el) for (const root of closedRoots) {
      if (!root.host.isConnected) continue;
      el = deepQuery(root, selector); if (el) break;
    }
    let res = { ok: false, why: 'no element' };
    try {
      if (el && req.op === 'date') {
        for (const set of [reactSet, vue3Set, vue2Set]) {
          res = set(el, req);
          if (res.ok || res.why === 'no more' || res.why === 'unknown value type') break;
        }
      }
    } catch (err) { res = { ok: false, why: String(err?.message || err).slice(0, 120) }; }
    document.documentElement.setAttribute('data-af-bridge-result', JSON.stringify(res));
  });
})();
