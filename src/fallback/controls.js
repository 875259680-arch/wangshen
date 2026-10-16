// 控件适配：按“行为”而不是按网站写。每个适配器都做到 操作 → 等页面稳定 → 回读核验。
(() => {
  if (globalThis.AF?.controls) return;
  const AF = globalThis.AF;
  const { sleep, clean, norm, text, visible, sim, best, settle, waitFor, click, key, setValue, typeSearch, blur, isPlaceholder } = AF.util;
  const { dom } = AF.util;
  const { readValue, POPUP } = AF.scan;

  const ok = actual => ({ ok: true, actual });
  const trace = (...a) => { if (globalThis.AF_TRACE) globalThis.AF_TRACE.push(a.join(' ')); };
  const fail = reason => ({ ok: false, reason });

  // ---------- 文本 ----------
  async function fillText(f, value) {
    let v = String(value);
    if (f.maxLength && v.length > f.maxLength) v = cut(v, f.maxLength);
    if (f.kind === 'rich') {
      f.el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, v);
    } else {
      setValue(f.input, v);
    }
    // 受控输入框在 input 事件里同步更新；失焦校验稍晚，交给 fill() 的回读重试，不在这里固定干等。
    await settle(30, 200);
    blur(f.input || f.el);
    await settle(30, 300);
    return v;
  }
  // 超长文字在句子边界截断。
  function cut(v, n) {
    const s = v.slice(0, n);
    const i = Math.max(s.lastIndexOf('。'), s.lastIndexOf('；'), s.lastIndexOf('\n'), s.lastIndexOf('.'));
    if (i > n * 0.6) return s.slice(0, i + 1);
    const j = Math.max(s.lastIndexOf('，'), s.lastIndexOf('、'), s.lastIndexOf(','));
    return j > n * 0.6 ? s.slice(0, j) + '。' : s;
  }

  const licenseClass = (f, want, actual) => /驾照|驾驶|准驾|车型/.test(f.label || '') && /^c1(?:驾照|驾驶证)?$/.test(norm(want)) && /^(c照|小型汽车)$/.test(norm(actual));
  function optionBest(f, value, options, getText) {
    const hit = best(value, options, getText);
    // 搜索框会先过滤掉“大类”选项；资料明确属于该类时在过滤前选择，不能反向推测子类。
    if (hit.score < 0.8) {
      const item = options.find(o => licenseClass(f, value, getText(o)));
      if (item) return { item, score: 0.97 };
    }
    return hit;
  }

  // ---------- 原生下拉 ----------
  async function fillNativeSelect(f, value, ctx) {
    const opts = [...f.el.options].filter(o => !(o.value === '' && isPlaceholder(o.text)));
    let { item, score } = optionBest(f, value, opts, o => o.text);
    if (score < 0.55) item = opts[await ctx.pick(f, value, opts.map(o => clean(o.text)))] || null;
    if (!item) return fail(`选项里没有“${value}”`);
    setValue(f.el, item.value);
    await settle(60, 500);
    return { chosen: clean(item.text) };
  }

  // ---------- 单选 / 多选 ----------
  async function fillChoice(f, value, ctx) {
    if (f.kind === 'checkbox' && f.options.length === 1) {
      const want = /^(是|yes|true|有|勾选|同意)$/i.test(clean(value)) || sim(value, f.options[0].text) > 0.8;
      const cur = f.options[0].input ? f.options[0].input.checked : readValue(f) !== '';
      if (want !== cur) click(f.options[0].input && !visible(f.options[0].el) ? f.options[0].input : f.options[0].el);
      await settle(60, 500);
      const fresh = ctx.refind?.() || f;
      const input = fresh.options?.[0]?.input;
      // 非 label 的视觉外壳没有原生激活行为；先读状态，未改变时才激活原生 input，避免正常标签被点两次。
      if (input?.isConnected && input.checked !== want && !input.disabled && !dom.closest(input, '[aria-disabled=true],[disabled]')) {
        input.click(); await settle(60, 500);
      }
      return null;
    }
    const wanted = f.kind === 'checkbox' ? String(value).split(/[、,，;；|]/).map(clean).filter(Boolean) : [String(value)];
    const chosen = [];
    for (const w of wanted) {
      let { item, score } = optionBest(f, w, f.options, o => o.text);
      if (score < 0.55) item = f.options[await ctx.pick(f, w, f.options.map(o => o.text))] || null;
      if (!item) return fail(`选项里没有“${w}”`);
      chosen.push(item.text);
      const checked = item.input?.checked || item.el.getAttribute('aria-checked') === 'true';
      if (!checked) { click(item.el); await settle(60, 500); }
      if (item.input && !item.input.checked && f.kind === 'radio') { item.input.click(); await settle(60, 400); }
    }
    return { chosen: chosen.join('、') };
  }

  // ---------- 自定义下拉 / 级联 ----------
  function floating(el) {
    if (dom.closest(el, POPUP)) return true;
    for (let cur = el, i = 0; cur && cur !== document.body && i < 12; cur = dom.parent(cur), i++) {
      const p = getComputedStyle(cur).position;
      if (p === 'absolute' || p === 'fixed') return true;
    }
    return false;
  }
  // 页面上所有“有自己文字”的可见元素。打开下拉前后各取一次，新出现的就是选项——不依赖任何类名。
  let candidateRevision = 0;
  const candidateCache = new WeakMap();
  const candidateObserver = new MutationObserver(() => { candidateRevision++; });
  candidateObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['role', 'id'] });
  function candidates(scope = document.body) {
    // 只复用“可能有文字的节点”，不缓存可见性；纯 CSS 动画没有 DOM 通知，缓存可见结果会永远漏选项。
    dom.sync();
    if (candidateObserver.takeRecords().length) candidateRevision++;
    const revision = candidateRevision + dom.revision;
    let cache = candidateCache.get(scope);
    if (!cache || cache.revision !== revision) {
      const nodes = [...dom.all(scope, '*')].filter(el => {
        if (el.childElementCount > 8 || /^(SCRIPT|STYLE|INPUT|TEXTAREA|SELECT|svg|path)$/i.test(el.tagName)) return false;
        return [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()) || el.matches('[role=option],[role=menuitem],[role=treeitem],li');
      });
      cache = { revision, nodes }; candidateCache.set(scope, cache);
    }
    return cache.nodes.filter(el => {
      const t = text(el);
      return t && t.length <= 60 && visible(el) && !dom.closest(el, '#' + AF.scan.PANEL_ID);
    });
  }
  // 浮层：挂在页面上、绝对/固定定位的弹出层。紧挨着控件的那一个就是它的面板——
  // 即使它在操作前就开着（上一步没关掉），也能认出来。
  const layerOwners = new WeakMap();
  const floatingSelf = el => /absolute|fixed/.test(getComputedStyle(el).position);
  function nearLayer(f) {
    const set = new Set();
    for (const el of dom.all(document, POPUP + ',[class*=picker-container],[class*=calendar-picker]')) if (floatingSelf(el) && visible(el)) set.add(el);
    for (const a of document.body.children) for (const el of [a, ...a.children]) if (el.id !== AF.scan.PANEL_ID && floatingSelf(el) && visible(el)) set.add(el);
    const layers = [...set].filter(e => (e.childElementCount > 0 || dom.shadow(e)) && !e.matches('[role=alert]') && candidates(e).length > 0 && ![...set].some(o => o !== e && dom.contains(o, e)) && !dom.contains(e, f.el) && !dom.closest(e, '#' + AF.scan.PANEL_ID) && (!layerOwners.has(e) || layerOwners.get(e) === f.key));
    const r = f.el.getBoundingClientRect();
    let best = null, gap = 60;
    for (const l of layers) {
      const q = l.getBoundingClientRect();
      if (q.right < r.left - 20 || q.left > r.right + 20) continue;           // 水平上要和控件对得上
      const d = Math.max(0, q.top - r.bottom, r.top - q.bottom);
      if (d < gap) { gap = d; best = l; }
    }
    return best;
  }
  // 打开前后对比，新出现、浮在上层的就是选项；再加上紧挨着控件的浮层里的内容。嵌套时取最里层（点击会冒泡到外层处理器）。
  function newOptions(before, f) {
    const near = nearLayer(f);
    // 延迟关闭的上一题浮层仍在 DOM 中，距离近也不能借给下一题；真正新出现的选项仍按前后差异识别。
    if (near) layerOwners.set(near, f.key);
    const fresh = candidates(near || document.body).filter(el => (!before.has(el) || (near && dom.contains(near, el))) && !(f.input && dom.contains(el, f.input)) && !(dom.contains(f.el, el) && !dom.closest(el, POPUP)) && (dom.contains(near, el) || floating(el)));
    return fresh.filter(el => !fresh.some(o => o !== el && dom.contains(el, o)))
      .filter(el => !DANGER.test(text(el)) && !dom.closest(el, '[aria-disabled=true],[disabled]'))
      .filter(el => !/^(暂无数据|无数据|no data|加载中|loading|[«»‹›<>⌄˅∨×✓]+)$/i.test(text(el)));
  }
  const popupOpen = (before, f) => newOptions(before, f).length > 0;

  // 填写触发的确认框（如“已选择另一学历为最高学历，是否修改？”）：这正是要做的修改，点确认。
  // 涉及删除/提交/离开等的不碰，交给用户。
  const DANGER = /删除|提交|投递|放弃|离开|退出|清空|重新解析|覆盖简历|撤回|保存申请/;
  async function handleDialog() {
    const dlg = [...dom.all(document, '[role=dialog],[role=alertdialog],[class*=modal],[class*=Modal],[class*=dialog],[class*=Dialog],[class*=confirm]')]
      .filter(d => visible(d) && !dom.closest(d, '#' + AF.scan.PANEL_ID) && /是否|确认|确定/.test(text(d)) && text(d).length < 300)
      .filter((d, i, all) => !all.some(o => o !== d && dom.contains(d, o) && /是否|确认|确定/.test(text(o))))[0];
    if (!dlg) return null;
    const t = text(dlg).replace(/\s*(取消|确认|确定)\s*/g, ' ').trim().slice(0, 60);
    if (DANGER.test(t)) return { blocked: t };
    const btn = [...dom.all(dlg, 'button,a,[role=button]')].filter(visible).find(b => /^(确\s*认|确\s*定|是|好的|ok|yes)$/i.test(text(b)));
    if (!btn) return { blocked: t };
    click(btn);
    await settle(100, 800);
    return { confirmed: t };
  }

  async function closePopup(f, before) {
    if (await handleDialog()) return;
    if (!popupOpen(before, f)) return;
    key(f.input || document.activeElement || document.body, 'Escape');
    await settle(60, 300);
    if (popupOpen(before, f)) {
      const opts = { bubbles: true, cancelable: true, clientX: 2, clientY: 2 };
      document.body.dispatchEvent(new MouseEvent('mousedown', opts));
      document.body.dispatchEvent(new MouseEvent('mouseup', opts));
      document.body.dispatchEvent(new MouseEvent('click', opts));
      await settle(60, 300);
    }
  }

  // 虚拟列表：没找到就向下滚动选项容器继续找。
  async function scrollFind(seg, before, f, pool = () => newOptions(before, f)) {
    const first = newOptions(before, f)[0];
    // 只在弹层内部滚动：找到选项所在的浮层，滚动容器必须在它里面，绝不滚动整个网页。
    let layer = null;
    for (let cur = first; cur && cur !== document.body; cur = dom.parent(cur)) if (floatingSelf(cur)) layer = cur;
    if (!layer) return null;
    let box = dom.parent(first);
    while (box && dom.contains(layer, box) && box.scrollHeight <= box.clientHeight + 4) box = dom.parent(box);
    if (!box || !dom.contains(layer, box)) return null;
    for (let i = 0; i < 25; i++) {
      box.scrollTop += Math.max(120, box.clientHeight * 0.8);
      await sleep(80);
      const opts = pool();
      const hit = best(seg, opts, o => text(o));
      if (hit.score >= 0.8) return hit.item;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) break;
    }
    return null;
  }

  const TRIGGER = '[class*=selector],[class*=selection],[class*=wrapper],[class*=trigger],[class*=Control],input';
  // 两个字的按钮常被渲染成“确 定”（Ant 会在中间插空格）；只认“确定”时从没点过提交，关弹层就把选择丢了。
  const ACTION = /^(确\s*认|确\s*定|完\s*成|ok|confirm|done|取\s*消|清\s*空|重\s*置|cancel|clear)$/i;
  const CONFIRM = /^(确\s*认|确\s*定|完\s*成|ok|confirm|done)$/i;
  // 地区面板顶部的“全国 / 上海市”标签、面包屑是已走过的路径，不是这一级的选项；以前第二个“上海市”会点到标签上。
  const inTabs = el => { for (let c = el, i = 0; c && i < 6; c = dom.parent(c), i++) if (/^(tab|tablist)$/.test(c.getAttribute?.('role') || '') || (c.classList && [...c.classList].some(x => /(^|[-_])(tabs?|breadcrumb)([-_]|$)/i.test(x)))) return true; return false; };
  // 选项旁边真正的“选中”开关（圆圈/方框）。这类地区面板里点名字只是进入下一级，点圆圈才算选中。
  const MARK = 'input[type=radio],input[type=checkbox],[role=radio],[role=checkbox]';
  const markLike = el => el.matches?.(MARK) || (el.classList && [...el.classList].some(x => /(^|[-_])(radio|checkbox)([-_](inner|input|box|icon))?$/i.test(x)));
  function markOf(item) {
    for (let c = dom.parent(item), i = 0; c && c !== document.body && i < 3; c = dom.parent(c), i++) {
      const marks = [c, ...dom.all(c, '*')].filter(markLike);
      if (marks.length > 1) return null;          // 爬到多个选项的公共容器了
      if (marks.length === 1) return marks[0].matches('input') && !visible(marks[0]) ? dom.parent(marks[0]) : marks[0];
    }
    return null;
  }
  const isChecked = m => {
    const input = m.matches('input') ? m : dom.one(m, 'input[type=radio],input[type=checkbox]');
    if (input) return input.checked;
    return m.getAttribute('aria-checked') === 'true' || [m, ...dom.all(m, '*')].some(x => x.classList && [...x.classList].some(c => /(^|[-_])(checked|is-checked|on|active|selected)$/i.test(c)));
  };
  // 弹层自带的搜索框（触发框只读时，搜索在弹层里）。
  function layerSearch(f) {
    const layer = nearLayer(f);
    return layer ? [...dom.all(layer, 'input:not([type]),input[type=text],input[type=search]')].find(i => visible(i) && !i.readOnly && !i.disabled && i !== f.input) || null : null;
  }
  // 打开弹层：已经开着就不再点（再点会关上）；点了没反应再点一次。
  async function openPopup(f, base, target) {
    if (newOptions(base, f).length) return true;
    const t = target || dom.one(f.el, TRIGGER) || f.el;
    for (let k = 0; k < 2; k++) {
      click(t);
      await settle(80, 600);
      if (await waitFor(() => newOptions(base, f).length > 0, k ? 1500 : 900)) return true;
    }
    return false;
  }

  async function fillSelect(f, value, ctx, base) {
    const whole = String(value);
    const segs = whole.split(/\s*[\/／>]\s*/).filter(Boolean);
    let path = segs.length > 1 && segs.length <= 4 ? segs : [whole];
    const before = base || new Set(candidates());
    const searchable = f.input && !f.input.readOnly;
    let typed = false;
    let open;
    if (searchable) {
      click(dom.one(f.el, TRIGGER) || f.el);
      await settle(80, 400);
      open = !!(await waitFor(() => newOptions(before, f).length, 350));
    } else open = await openPopup(f, before);
    const search = async want => {
      typed = true;
      if (!await typeSearch(f.input, want)) return false;
      // DOM 安静并不代表远程请求已返回；等目标选项，不能用“已有任意一项”提前选到旧结果。
      const found = await waitFor(() => optionBest(f, want, newOptions(before, f), o => text(o)).score >= 0.8, 3000, 80);
      await settle(80, 400);
      return !!found;
    };
    if (searchable && (!open || optionBest(f, path[0], newOptions(before, f), o => text(o)).score < 0.8)) {
      open = await search(path[0]);
    }
    if (!open) return fail('点开后没有出现选项');
    if (path.length > 1 && best(whole, newOptions(before, f), o => text(o)).score >= 0.8) path = [whole];
    const clicked = [], chosen = [];
    // 只排除已点过的同一节点；直辖市的省和市可以同名、同位置，按文字去重会漏掉第二级。
    const fresh = () => newOptions(before, f).filter(o => !ACTION.test(text(o)) && !inTabs(o)
      && !clicked.some(c => c.el === o && c.text === text(o)));
    let seg = 0, lastScore = 0, searchedLayer = false;
    for (let depth = 0; depth < 6; depth++) {
      const beyond = depth > 0 && seg >= path.length - 1 && lastScore >= 0.8 && chosen.length >= path.length; // 资料给的层级已经用完
      let opts = fresh();
      if (!opts.length) break;
      // 资料里更深的一级已经露出来了就直接跳过去：直辖市“上海市/上海市/杨浦区”在很多面板里没有第二个“上海市”这一级。
      // 分数必须不低于当前这一级，否则“吉林省/吉林市”会因去掉省市后同名而跳级；
      // 和当前这一级同名的不跳——真有“上海市 > 上海市”两级的级联，跳了就少点一级。
      if (!beyond) {
        const here = optionBest(f, path[seg], opts, o => text(o)).score;
        for (let s = path.length - 1; s > seg; s--) {
          if (norm(path[s]) === norm(path[seg])) continue;
          const sc = optionBest(f, path[s], opts, o => text(o)).score;
          if (sc >= 0.9 && sc >= here) { seg = s; break; }
        }
      }
      const want = path[Math.min(seg, path.length - 1)];
      let { item, score } = beyond ? { item: null, score: 0 } : optionBest(f, want, opts, o => text(o));
      if (score < 0.8) { const hit = await scrollFind(want, before, f, fresh); if (hit) { item = hit; score = 0.8; } }
      // 触发框只读、搜索框在弹层里：按最深一级搜（搜“杨浦区”比一级级找快，也能找到没露出来的项）。
      if (score < 0.8 && !beyond && !searchedLayer && !searchable) {
        const box = layerSearch(f);
        if (box) {
          searchedLayer = true;
          const last = path[path.length - 1];
          await typeSearch(box, last);
          await waitFor(() => optionBest(f, last, fresh(), o => text(o)).score >= 0.8, 2000, 80);
          const hit = optionBest(f, last, fresh(), o => text(o));
          if (hit.score >= 0.8) { item = hit.item; score = hit.score; seg = path.length - 1; }
        }
      }
      if (score < 0.8) {
        // 让 AI 在这一栏里选：上级分类（管理学）、区间（前10% → 前20%）、近义（有 → C照）
        opts = fresh();
        const ask = beyond ? `${whole}（还需选择下一级，请根据资料选择）` : path.length > 1 || depth > 0 ? `${want}（完整值：${whole}）` : whole;
        const idx = await ctx.pick(f, ask, opts.map(o => text(o)));
        if (opts[idx]) { item = opts[idx]; score = 0.8; } else if (score < 0.55) item = null;
      }
      if (!item && searchable && !typed) {
        await search(want);
        continue;
      }
      if (!item && beyond) { await closePopup(f, before); return fail(`还需要选下一级（资料只到“${chosen.join('/')}”），请手动选择后点“记住”`); }
      if (!item) break;
      const prev = new Set(fresh().map(o => text(o)));   // 按文字比：面板整体重绘不算“出现下一级”
      clicked.push({ el: item, text: text(item), x: item.getBoundingClientRect().left });
      chosen.push(text(item));
      lastScore = score;
      const mark = markOf(item);
      click(item);
      await settle(40, 300);
      // 下一级是一批新选项；“已选地区 0/1 → 1/1”这种只冒出一个新字的不算，以前会被当成还有下一级而交给人工。
      const grown = () => {
        const add = new Set(fresh().map(o => text(o)).filter(t => !prev.has(t)));
        return add.size >= 2 || (add.size === 1 && seg + 1 < path.length && sim(path[seg + 1], [...add][0]) >= 0.8);
      };
      // 出现下一栏 → 继续；弹层收起或这一项已被选中 → 结束。都没发生才等满。
      await waitFor(() => grown() || !newOptions(before, f).length || (mark?.isConnected && isChecked(mark)), 700);
      const deeper = grown();
      trace('click', text(item), 'score', score.toFixed(2), 'deeper', deeper, 'fresh', fresh().map(o => text(o)).join(','));
      if (seg < path.length - 1) {
        if (!deeper) break;          // 网页层级比资料少（如只有省/市），到此为止
        seg++;
        continue;
      }
      // 路径已走完：没有下一栏就结束；出现下一栏（级联里先选了上级分类）就继续找同一个值。
      if (!deeper) break;
      // 出现了下一级：继续循环。资料给的层级已用完时，下一轮会让 AI 结合资料来选（如籍贯只给了省 → 按资料选市），选不出才交给人工。
    }
    if (!chosen.length) { await closePopup(f, before); return fail(`选项里没有“${whole}”`); }
    // 最后一项旁边有圆圈/方框而还没选中：点名字只是“看下一级”或什么都没做，要点开关本身。
    const last = clicked[clicked.length - 1]?.el;
    const lastMark = last?.isConnected ? markOf(last) : null;
    if (lastMark && !isChecked(lastMark)) {
      click(lastMark);
      await waitFor(() => isChecked(lastMark) || !lastMark.isConnected, 500);
    }
    const confirm = newOptions(before, f).find(el => CONFIRM.test(text(el)));
    if (confirm) { click(confirm); await settle(100, 600); }
    await closePopup(f, before);
    return { chosen: chosen.join('/') };
  }

  // ---------- 文件 ----------
  async function fillFile(f, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    f.input.files = dt.files;
    f.input.dispatchEvent(new Event('input', { bubbles: true }));
    f.input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(300, 3000);
    return ok(file.name);
  }

  // ---------- 核验 ----------
  function matches(f, actual, value) {
    if (f.kind === 'checkbox' && f.options?.length === 1) {
      const on = /^(是|yes|true|有|勾选|同意)$/i.test(clean(value)) || sim(value, f.options[0].text) > 0.8;
      return on === !!actual;
    }
    // 结束时间要“至今”、而旁边的“至今”已勾上：日期框留空（或被禁用）就是对的。
    if (/date/.test(f.kind) && AF.dates.isNow(value) && AF.dates.nowTicked(f)) return true;
    if (!actual) return false;
    const want = String(value);
    // 只允许明确车型向界面大类回读，不能反过来推测更细的准驾车型。
    if (licenseClass(f, want, actual)) return true;
    if (f.kind === 'date' || f.kind === 'daterange' || f.kind === 'native-date') return AF.dates.matches(f, actual, want);
    if (f.kind === 'text' || f.kind === 'textarea' || f.kind === 'rich') return norm(actual).startsWith(norm(want).slice(0, Math.max(1, Math.min(norm(want).length, (f.maxLength || 1e9) - 5))));
    const last = want.split(/\s*[\/／>]\s*/).pop();
    return sim(actual, want) >= 0.5 || sim(actual.split(/\s*[\/／>]\s*/).pop(), last) >= 0.7 || norm(actual).includes(norm(last));
  }

  async function fill(f, value, ctx) {
    let r = null, base = null;
    try {
      if (f.kind === 'text' && /籍贯|地区|省|城市|所在地|户口|户籍|生源|居住地|出生地|地点/.test(f.label) && (base = await opensPopup(f))) r = await fillSelect({ ...f, kind: 'select', cascader: true }, value, ctx, base);
      else if (f.kind === 'text' || f.kind === 'textarea' || f.kind === 'rich') r = { chosen: await fillText(f, value) };
      else if (f.kind === 'native-select') r = await fillNativeSelect(f, value, ctx);
      else if (f.kind === 'radio' || f.kind === 'checkbox') r = await fillChoice(f, value, ctx);
      // 外观是下拉、实际是日期选择器（“请选择”+ 日历）：值是年月就按日期处理。
      else if (f.kind === 'select' && /^\d{4}\s*[-/.年]\s*\d{1,2}/.test(String(value))) {
        r = await AF.dates.fillDate({ ...f, kind: 'date' }, value, ctx);
        if (!r || r.ok !== false) f = { ...f, kind: 'date' };   // 按日期核验
      }
      else if (f.kind === 'select') r = await fillSelect(f, value, ctx);
      // 按占位符认成日期、值却不是日期（“随时”“待定”）的输入框：当普通文字填。
      else if (f.kind === 'date' && f.input && !f.input.readOnly && !AF.dates.parseDate(value) && !/至今|present/i.test(value)) { f = { ...f, kind: 'text' }; r = { chosen: await fillText(f, value) }; }
      else if (f.kind === 'date' || f.kind === 'daterange' || f.kind === 'native-date') r = await AF.dates.fillDate(f, value, ctx);
      else return fail('不支持的控件');
    } catch (e) {
      return fail(e.message || String(e));
    }
    if (r && r.ok === false) return r;
    if (r && r.ok === true) return r;      // 适配器自己已核验（如勾上了“至今”）
    const dlg = await handleDialog();
    if (dlg?.blocked) return fail(`网页弹出“${dlg.blocked}”，请手动处理`);
    const want = r?.chosen || value;
    // 回读：控件可能已被页面替换，用 key 重新找。
    let actual = '';
    for (let i = 0; i < 8; i++) {
      const fresh = ctx.refind();
      actual = fresh ? readValue(fresh) : '';
      if (fresh && matches(f, actual, want) && !AF.dates.emptyError(fresh)) return ok(actual);
      await sleep(120);
    }
    return fail(actual ? `网页显示为“${actual.slice(0, 20)}”` : '网页没有接受该值');
  }

  // 看起来是输入框、点开却弹出选择面板的控件。弹层开着就留着，把打开前的基准交给 fillSelect。
  async function opensPopup(f) {
    const before = new Set(candidates());
    click(f.input || f.el);
    await settle(80, 500);
    if (await waitFor(() => newOptions(before, f).length >= 3, 700)) return before;
    await closePopup(f, before);
    return null;
  }

  // 只读选项（不选择）：给 AI 看完整选项列表用。
  async function readOptions(f) {
    if (f.options?.length) return f.options.map(o => o.text);
    if (f.kind !== 'select') return [];
    const before = new Set(candidates());
    const trigger = dom.one(f.el, '[class*=selector],[class*=selection],[class*=wrapper],[class*=trigger],[class*=Control],input') || f.el;
    click(trigger);
    await settle(80, 600);
    const opts = await waitFor(() => { const o = newOptions(before, f); return o.length ? o : null; }, 1200) || [];
    const texts = [...new Set(opts.map(o => text(o)))].slice(0, 200);
    await closePopup(f, before);
    return texts;
  }

  AF.controls = { fill, fillFile, matches, readOptions, handleDialog, _ui: { candidates, newOptions, openPopup, closePopup, nearLayer } };
})();
