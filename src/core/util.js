// 通用工具：文本归一、可见性、相似度、DOM 稳定等待、真实感事件。
(() => {
  if (globalThis.AF?.util) return;
  const AF = (globalThis.AF ||= {});

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const { clean, norm, canon, sim, best, isPlaceholder } = AF.text;
  const text = el => clean(dom.shadow(el)?.textContent ?? el?.innerText ?? el?.textContent ?? '');

  // 选择器、祖先与命中测试都走同一棵跨影子根的树；只改扫描会导致“看到了字段，却找不到选项/标签”。
  const dom = (() => {
    const roots = new Set(), hosts = new Set();
    let revision = 0, refreshed = 0;
    const shadow = el => {
      if (!el || el.id === 'af-panel-host') return null;
      if (el.shadowRoot) return el.shadowRoot;
      try { return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) || null; } catch (_) { return null; }
    };
    const parent = el => el?.assignedSlot || el?.parentElement || el?.getRootNode?.()?.host || null;
    const contains = (root, el) => {
      if (!root || !el) return false;
      if (root === el || root.contains?.(el)) return true;
      for (let n = el; n; n = parent(n)) if (n === root || n.getRootNode?.() === root) return true;
      return false;
    };
    const observer = new MutationObserver(records => update(records));
    function visit(node) {
      if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
      if (node.nodeType === 1 && (node.id === 'af-panel-host' || node.closest('#af-panel-host'))) return;
      const nodes = node.nodeType === 1 ? [node, ...node.querySelectorAll('*')] : [...node.querySelectorAll('*')];
      for (const el of nodes) {
        // 普通元素也能 attachShadow，不能只检查带横线的自定义标签。
        hosts.add(el);
        const r = shadow(el);
        if (r && !roots.has(r)) {
          roots.add(r); observer.observe(r, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['role', 'id'] });
          visit(r); revision++;
        }
      }
    }
    function update(records) {
      for (const r of records) {
        if (contains(document.getElementById('af-panel-host'), r.target)) continue;
        revision++;
        for (const n of r.addedNodes || []) visit(n);
      }
    }
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['role', 'id'] });
    visit(document);
    function sync() {
      update(observer.takeRecords());
      // 在已有 host 上延迟 attachShadow 不会触发外部 DOM 通知，低频复查避免永远漏掉它。
      if (Date.now() - refreshed > 1000) {
        refreshed = Date.now();
        for (const el of hosts) {
          if (!el.isConnected) { hosts.delete(el); continue; }
          const r = shadow(el);
          if (r && !roots.has(r)) { roots.add(r); observer.observe(r, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['role', 'id'] }); visit(r); revision++; }
        }
        for (const r of roots) if (!r.host.isConnected) roots.delete(r);
      }
    }
    function all(root, selector) {
      if (!root) return [];
      sync();
      const out = [...root.querySelectorAll(selector)];
      for (const r of roots) if (r !== root && contains(root, r.host)) out.push(...r.querySelectorAll(selector));
      return [...new Set(out)];
    }
    const one = (root, selector) => all(root, selector)[0] || null;
    const closest = (el, selector) => { for (let n = el; n; n = parent(n)) if (n.matches?.(selector)) return n; return null; };
    const children = el => {
      if (el?.tagName === 'SLOT') { const assigned = el.assignedNodes?.({ flatten: true }); if (assigned?.length) return assigned; }
      return (shadow(el) || el)?.childNodes || [];
    };
    function position(a, b) {
      const normal = a.compareDocumentPosition(b);
      if (!(normal & Node.DOCUMENT_POSITION_DISCONNECTED)) return normal;
      const chain = n => { const out = []; for (; n; n = parent(n)) out.unshift(n); return out; };
      const A = chain(a), B = chain(b); let i = 0;
      while (i < A.length && i < B.length && A[i] === B[i]) i++;
      if (i === A.length) return Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY;
      if (i === B.length) return Node.DOCUMENT_POSITION_PRECEDING | Node.DOCUMENT_POSITION_CONTAINS;
      return A[i].compareDocumentPosition(B[i]);
    }
    function hit(x, y) {
      let el = document.elementFromPoint(x, y);
      for (let i = 0; el && i < 20; i++) {
        const r = shadow(el), next = r?.elementFromPoint?.(x, y);
        if (!next || next === el) break;
        el = next;
      }
      return el;
    }
    return { all, one, closest, contains, parent, children, position, hit, shadow, sync,
      get roots() { sync(); return [...roots]; }, get revision() { return revision; } };
  })();

  function visible(el) {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  }

  // 等待页面 DOM 安静下来（框架重渲染、弹层动画）。
  function settle(quiet = 120, max = 1200) {
    return new Promise(resolve => {
      let t;
      const done = () => { obs.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(); };
      const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, quiet); });
      for (const r of dom.roots) obs.observe(r, { subtree: true, childList: true, attributes: true, characterData: true });
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      t = setTimeout(done, quiet);
      const cap = setTimeout(done, max);
    });
  }
  async function waitFor(fn, timeout = 1500, step = 60) {
    const end = Date.now() + timeout;
    do { const v = fn(); if (v) return v; await sleep(step); } while (Date.now() < end);
    return fn();
  }

  // 模拟一次真实点击：pointer/mouse 全序列，落点取元素中心实际命中的节点。
  function click(el) {
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 40), y = r.top + r.height / 2;
    const hit = dom.hit(x, y);
    const target = hit && (dom.contains(el, hit) || dom.contains(hit, el)) ? hit : el;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.focus?.({ preventScroll: true });
    target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
  }
  function key(el, k, extra = {}) {
    const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40 };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      if (type === 'keypress' && k !== 'Enter') continue;
      el.dispatchEvent(new KeyboardEvent(type, { key: k, code: k, keyCode: codes[k], which: codes[k], bubbles: true, cancelable: true, ...extra }));
    }
  }
  // 绕过 React/Vue 对 value 的拦截，再派发 input/change。
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus?.({ preventScroll: true });
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: String(value), inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // 搜索控件常把键盘/组合输入当成查询开关；整段赋值只有 input，会让远程学校列表一直为空。
  async function typeSearch(el, value) {
    el.focus?.({ preventScroll: true });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const put = v => setter ? setter.call(el, v) : (el.value = v);
    put('');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
    const chinese = /[\u3400-\u9fff]/.test(value);
    const composition = (type, data) => el.dispatchEvent(new CompositionEvent(type, { bubbles: true, composed: true, data }));
    if (chinese) composition('compositionstart', '');
    let current = '';
    for (const ch of String(value)) {
      if (!el.isConnected) return false;
      const opts = { key: ch, bubbles: true, composed: true, cancelable: true, isComposing: chinese };
      const down = el.dispatchEvent(new KeyboardEvent('keydown', opts));
      const press = down && el.dispatchEvent(new KeyboardEvent('keypress', opts));
      if (press) {
        const next = current + ch;
        if (chinese) composition('compositionupdate', next);
        if (el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, data: ch, inputType: chinese ? 'insertCompositionText' : 'insertText', isComposing: chinese }))) {
          current = next; put(current);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: ch, inputType: chinese ? 'insertCompositionText' : 'insertText', isComposing: chinese }));
        }
      }
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
      await sleep(25);
    }
    if (chinese) {
      composition('compositionend', current);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: current, inputType: 'insertText', isComposing: false }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return current === String(value) && el.isConnected;
  }

  function blur(el) {
    el?.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    el?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el?.blur?.();
  }


  AF.util = { sleep, clean, norm, text, visible, sim, best, canon, settle, waitFor, click, key, setValue, typeSearch, blur, isPlaceholder, dom };
})();
