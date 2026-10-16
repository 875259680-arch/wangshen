// 日期控件：不按网站写，按“控件实际表现”逐级尝试，每一级都回读核验，成功才停。
//   1. 原生 date/month 输入框：按 type 要求的格式直接写。
//   2. 能键入的输入框：按占位符 / 页面上已有日期 / 长度限制推断格式，键入 → 回车 → 失焦。
//   3. 日历面板：看面板上“真正露在最上层”的格子判断当前是 年 / 月 / 日 / 滚轮 视图，
//      逐级翻页、点选；被盖住的旧标题、上月/下月的灰格子、禁用格子都不算。
//   4. 框架兜底：通过主环境桥（bridge.js）调用组件自己的 onChange / v-model（React、Vue2、Vue3）。
// 核验：失焦后读回年/月（资料有日时连日一起核），并检查网页是否仍提示“请选择/必填”——
// 显示了文字但组件没收到值，是网申日期最常见的假成功。
(() => {
  if (globalThis.AF?.dates) return;
  const AF = globalThis.AF;
  const { sleep, clean, text, visible, settle, waitFor, click, key, setValue, blur } = AF.util;
  const { dom } = AF.util;
  const { readValue } = AF.scan;
  const trace = (...a) => { if (globalThis.AF_TRACE) globalThis.AF_TRACE.push(a.join(' ')); };
  const fail = reason => ({ ok: false, reason });
  const ui = () => AF.controls._ui;

  // ---------- 解析 ----------
  const MONTH_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const NOW = /^(至今|现在|今|目前|在职|在读|至今在职|present|now|current|till now|to date)$/i;
  const pad = n => String(n).padStart(2, '0');

  // 返回 { y, m, d, hasMonth, hasDay }；年月日都是字符串（两位补零），兼容 2019-9、2019.09、2019年9月、201909、09/2019、Sep 2019。
  function parseDate(v) {
    const s = clean(v);
    if (!s) return null;
    let y, m, d, hasMonth = true, hasDay = false;
    let r;
    if ((r = s.match(/((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2}))?/))) [, y, m, d] = r;
    else if ((r = s.match(/^((?:19|20)\d{2})(\d{2})(\d{2})?$/))) [, y, m, d] = r;
    else if ((r = s.match(/^(\d{1,2})\s*[-/.]\s*((?:19|20)\d{2})$/))) [, m, y] = r;
    else if ((r = s.match(/([a-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?((?:19|20)\d{2})/i)) && MONTH_EN.includes(r[1].slice(0, 3).toLowerCase())) {
      y = r[3]; m = MONTH_EN.indexOf(r[1].slice(0, 3).toLowerCase()) + 1; d = r[2];
    } else if ((r = s.match(/((?:19|20)\d{2})/))) { y = r[1]; m = 1; hasMonth = false; }
    else return null;
    if (+m < 1 || +m > 12) return null;
    hasDay = d != null && d !== '';
    if (hasDay && (+d < 1 || +d > 31)) return null;
    return { y: String(y), m: pad(m), d: pad(hasDay ? d : 1), hasMonth, hasDay };
  }
  // 资料要求月/日时，回读也必须有月/日；以前只比双方共有的精度，会把仅年份的假成功算成完整日期。
  function same(actual, want) {
    if (!actual || !want || actual.y !== want.y) return false;
    if (!want.hasMonth) return true;
    if (!actual.hasMonth) return false;
    if (actual.m !== want.m) return false;
    return !want.hasDay || (actual.hasDay && actual.d === want.d);
  }
  const dateOk = (actualText, want) => same(parseDate(actualText), want);

  function expectedDate(f, value) {
    const d = parseDate(value); if (!d) return null;
    // 明确标为月份的控件只能保存年月；不能因输入来源带日而把合法月份误报为失败。
    // 只按控件声明或实际月份面板的提交行为减精度，不能按回读缺了什么就宽松放过。
    const hint = [f.label, ...(f.inputs || [f.input]).filter(Boolean).map(x => x.placeholder || '')].join(' ');
    if (f.calendarPrecision === 'month' || f.input?.type === 'month' || /年月|月份|yyyy[-/.]mm(?![-/.]dd)/i.test(hint)) d.hasDay = false;
    return d;
  }

  // 一个值拆成若干段：“2019-09 ~ 2023-06”、“2025.04-2025.08”、“2026-08 至今”。
  function splitRange(value) {
    const s = clean(value);
    const parts = s.split(/\s*(?:~|～|至(?!今)|到|—|–|\s-\s)\s*/).filter(Boolean);
    if (parts.length === 1) {
      // 2025.04-2025.08、2019/09-2023/06：两个完整日期用短横线相连
      const m = s.match(/^((?:19|20)\d{2}\D\d{1,2}(?:\D\d{1,2})?)\s*-\s*((?:19|20)\d{2}\D\d{1,2}(?:\D\d{1,2})?|至今)$/);
      if (m) return [m[1], m[2]];
      const now = s.match(/^(.+?)\s*(至今|present|now)$/i);
      if (now && parseDate(now[1])) return [now[1], now[2]];
    }
    return parts;
  }

  // ---------- 核验辅助 ----------
  // 网页的“必填”校验仍在提示：说明组件内部没收到值（只是显示了文字）。
  const EMPTY_ERR = /请选择|请输入|请填写|不能为空|不可为空|必填|未填写|is required|required|please (select|enter|input)/i;
  function emptyError(f) {
    let box = f.el;
    for (let i = 0; i < 4 && dom.parent(box) && dom.parent(box) !== document.body; i++) {
      box = dom.parent(box);
      // 上爬到相邻问题就停；以前只按“四个输入框”截断，会拿学校旁边未填的专业提示判学校失败。
      if ([...dom.all(box, 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select')]
        .some(el => !f.nodes?.includes(el) && !dom.contains(f.el, el) && visible(el))) break;
      const err = [...dom.all(box, '[class*=err],[class*=Err],[class*=explain],[class*=invalid],[class*=warn],[role=alert]')]
        .filter(e => visible(e) && !dom.contains(e, f.el) && !dom.contains(f.el, e) && !e.matches('input,textarea'))
        .map(e => text(e)).find(t => t && t.length < 60 && EMPTY_ERR.test(t));
      if (err) return err;
    }
    return '';
  }

  // ---------- 2. 键入 ----------
  // 推断网页要求的格式：占位符里的 yyyy-MM / YYYY年MM月 → 页面上已有的日期写法 → 长度限制 → 常见写法。
  const tok = (fmt, d) => fmt.replace(/yyyy|YYYY|MM|M|DD|dd|D|d/g, t => t[0].toLowerCase() === 'y' ? d.y : t === 'MM' ? d.m : t === 'M' ? String(+d.m) : /dd|DD/.test(t) ? d.d : String(+d.d));
  function shapeOf(sample, d) {
    const r = clean(sample).match(/^((?:19|20)\d{2})(\D*)(\d{1,2})(?:(\D*)(\d{1,2})(\D*))?$/);
    if (!r) return null;
    const mm = r[3].length === 2 ? d.m : String(+d.m);
    return r[5] != null ? `${d.y}${r[2]}${mm}${r[4]}${r[5].length === 2 ? d.d : String(+d.d)}${r[6] || ''}` : `${d.y}${r[2]}${mm}`;
  }
  function formats(d, input, f) {
    const out = [];
    const ph = input?.placeholder || '';
    if (/yyyy/i.test(ph)) out.push(tok(ph.match(/[yY]{4}[^\s]*/)[0], d));
    // 页面上其他日期框已有的值（网站解析简历后填的）就是它认可的写法。
    for (const el of dom.all(document, 'input:not([type=hidden])')) {
      if (el === input || !el.value) continue;
      const s = shapeOf(el.value, d);
      if (s) { out.push(s); break; }
    }
    const max = input?.maxLength > 0 ? input.maxLength : 0;
    if (max === 6) out.push(`${d.y}${d.m}`);
    if (max === 8) out.push(`${d.y}${d.m}${d.d}`);
    const hint = ph + ' ' + f.label + ' ' + (dom.closest(input, '[class]')?.className || '');
    const monthly = /年月|月份|month|yyyy[-/.]mm(?![-/.]dd)/i.test(hint) && !/日期|dd|date(?!-?(editor|picker))/i.test(ph);
    const sep = ph.includes('/') ? '/' : ph.includes('.') ? '.' : '-';
    const full = `${d.y}${sep}${d.m}${sep}${d.d}`, month = `${d.y}${sep}${d.m}`;
    out.push(...(monthly || !d.hasDay ? [month, full] : [full, month]), `${d.y}-${d.m}-${d.d}`, `${d.y}-${d.m}`, `${d.y}年${d.m}月`);
    return [...new Set(out)];
  }
  async function typeInto(input, s) {
    click(input);
    await settle(60, 300);
    input.select?.();
    setValue(input, s);
    key(input, 'Enter');
    await settle(80, 400);
  }

  // ---------- 3. 日历面板 ----------
  // 真正露在最上层的元素（被月份面板盖住的日期视图标题、动画中的旧面板都不算）。
  function onTop(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 20), y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true; // 视口外无法判断，按可见算
    const hit = dom.hit(x, y);
    // 插件自己的浮窗盖住的格子照样算露出来的。
    return !hit || hit === el || dom.contains(el, hit) || dom.contains(hit, el) || hit.id === AF.scan.PANEL_ID;
  }
  const OTHER_CELL = /(^|[-_\s])(prev|next|other|out|last|pre|outside|adjacent)([-_]|\s|$)|not-current|is-other|prev-month|next-month/i;
  const DISABLED = /disabled|forbid|unavailable/i;
  const IN_VIEW = /in-view|current-month|cur-month|curr-month|this-month/i;
  const cls = c => `${c.className} ${dom.parent(c)?.className || ''} ${dom.parent(dom.parent(c))?.className || ''}`;
  const disabledCell = c => DISABLED.test(cls(c)) || dom.closest(c, '[aria-disabled=true],[disabled]');
  function cellMonth(t) {
    let m = t.match(/^0?(\d{1,2})\s*月$/) || t.match(/^(十[一二]?|[一二三四五六七八九十])月(份)?$/);
    if (m) return /\d/.test(m[1]) ? Number(m[1]) : MONTH_CN.indexOf(m[1]) + 1;
    const e = MONTH_EN.indexOf(t.slice(0, 3).toLowerCase());
    return /^[a-z]{3,9}\.?$/i.test(t) && e >= 0 ? e + 1 : 0;
  }
  const cellYear = t => { const m = t.match(/^((?:19|20)\d{2})\s*年?$/); return m ? Number(m[1]) : 0; };
  const cellDecade = t => { const m = t.match(/^((?:19|20)\d{2})\s*[-–~]\s*((?:19|20)\d{2})$/); return m ? [Number(m[1]), Number(m[2])] : null; };

  // 读面板当前状态：哪些格子、属于哪种视图、标题显示的年月。
  function look(before, f) {
    const all = ui().newOptions(before, f);
    const top = all.filter(onTop);
    const opts = top.length >= 3 ? top : all;
    const distinct = list => new Set(list.map(o => text(o))).size;
    // 只有成批出现才算格子；单独一个“2026”“10月”是标题按钮。
    const batch = list => distinct(list) >= 3 ? list : [];
    // 年份面板两头的灰色年份（上/下一个十年）点了只会翻页，不算可选格子。
    const years = batch(opts.filter(o => cellYear(text(o)) && !OTHER_CELL.test(cls(o))));
    const decades = batch(opts.filter(o => cellDecade(text(o))));
    const months = batch(opts.filter(o => cellMonth(text(o))));
    let days = opts.filter(o => /^\d{1,2}$/.test(text(o)) && +text(o) >= 1 && +text(o) <= 31);
    const plainNums = days.length;
    days = days.filter(c => !OTHER_CELL.test(cls(c)));
    if (days.some(c => IN_VIEW.test(cls(c)))) days = days.filter(c => IN_VIEW.test(cls(c)));
    const cells = new Set([...years, ...decades, ...months, ...days]);
    const heads = opts.filter(o => !cells.has(o) && /(19|20)\d{2}/.test(text(o)));
    const header = scope => {
      const own = scope ? heads.filter(h => dom.contains(scope, h)) : heads;
      for (const o of own) {
        const t = text(dom.parent(o)).length <= 24 ? text(dom.parent(o)) : text(o);
        const y = Number(t.match(/((?:19|20)\d{2})/)[1]);
        const mm = t.match(/(\d{1,2})\s*月/) || t.match(/(?:19|20)\d{2}\s*[-/.]\s*(\d{1,2})(?!\d)/) || t.match(/(十[一二]?|[一二三四五六七八九十])月/);
        const me = MONTH_EN.findIndex(m => new RegExp('\\b' + m, 'i').test(t));
        const m = mm ? (/\d/.test(mm[1]) ? Number(mm[1]) : MONTH_CN.indexOf(mm[1]) + 1) : me >= 0 ? me + 1 : 0;
        return { el: o, y, m, range: /(19|20)\d{2}\D+(19|20)\d{2}/.test(t) };
      }
      return null;
    };
    let view = 'none';
    if (years.length && months.length) view = 'wheel';
    else if (distinct(years) >= 6 || decades.length >= 6) view = 'year';
    else if (distinct(months) >= 12) view = 'month';
    else if (distinct(days) >= 28 || (plainNums >= 28 && distinct(days) >= 20)) view = 'day';
    else if (opts.length && plainNums === 12 && !days.some(c => +text(c) > 12)) view = 'month';
    return { opts, years, decades, months, days, view, header };
  }
  // 按格子所在的表格分组（范围选择器左右各一个面板），每组配上自己的标题。
  function panels(cells, st) {
    const groups = new Map();
    for (const c of cells) {
      const g = dom.closest(c, 'table,[role=grid]') || dom.parent(dom.parent(c)) || dom.parent(c);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    return [...groups].map(([g, list]) => {
      let scope = g, head = null;
      for (let k = 0; k < 6 && scope && !head; k++, scope = dom.parent(scope)) head = st.header(scope);
      return { cells: list, head: head || st.header(null) };
    });
  }
  // 翻页按钮：从标题往外找；同时认出是“翻年”还是“翻月”。
  function navButtons(scope) {
    const all = [...dom.all(scope, 'button,a,span,i,div,[role=button]')].filter(b => visible(b) && b.childElementCount <= 2 && onTop(b));
    const sig = b => `${b.className?.baseVal ?? b.className} ${b.getAttribute('aria-label') || ''} ${b.title || ''} ${text(b)}`.toLowerCase();
    const kind = b => {
      const s = sig(b);
      const dir = /prev|left|上一|前一|上个|上月|«|‹|<|last|previous|back/.test(s) ? -1 : /next|right|下一|后一|下个|下月|»|›|>|forward/.test(s) ? 1 : 0;
      if (!dir || text(b).length > 3) return null;
      return { b, dir, year: /year|super|d-arrow|double|decade|«|»|年/.test(s) };
    };
    return all.map(kind).filter(Boolean).filter(x => !all.some(o => o !== x.b && dom.contains(x.b, o) && kind(o)));
  }
  function navFrom(el, dir, wantYear) {
    let scope = el;
    for (let k = 0; k < 8 && dom.parent(scope) && !navButtons(scope).some(x => x.dir === dir); k++) scope = dom.parent(scope);
    const btns = navButtons(scope).filter(x => x.dir === dir);
    // 范围选择器左右各有一组按钮：取离标题最近的那个。
    const r = el.getBoundingClientRect();
    const dist = x => { const q = x.b.getBoundingClientRect(); return Math.abs(q.left - r.left) + Math.abs(q.top - r.top); };
    const sorted = list => list.sort((a, b) => dist(a) - dist(b))[0];
    return wantYear ? (sorted(btns.filter(x => x.year)) || sorted(btns)) : (sorted(btns.filter(x => !x.year)) || sorted(btns));
  }
  // 点一下，并等面板真的变了（换视图、翻页、收起）：动画中的旧面板不能被当成新状态。
  const sigOf = (before, f) => ui().newOptions(before, f).filter(onTop).slice(0, 60).map(o => text(o)).join(',');
  let ctxBefore = null, ctxField = null;
  async function press(el) {
    const s0 = ctxBefore ? sigOf(ctxBefore, ctxField) : '';
    click(el);
    await settle(40, 300);
    if (ctxBefore) await waitFor(() => sigOf(ctxBefore, ctxField) !== s0, 800, 50);
    await settle(40, 300);
  }

  // 在已打开（或能打开）的面板里选中 d。返回 'picked' | 'disabled' | 'stuck'。
  async function calendarPick(f, input, d, keepOpen, base) {
    const before = base || new Set(ui().candidates());
    // 判断面板是否打开看有没有日历格子，而不是“有没有新元素”（键入后冒出的提示文字也是新元素）。
    if (look(before, f).view === 'none') {
      for (let k = 0; k < 2; k++) {
        click(input || f.el);
        await settle(80, 600);
        if (await waitFor(() => look(before, f).view !== 'none', k ? 1500 : 900)) break;
      }
    }
    if (look(before, f).view === 'none') return 'stuck';
    ctxBefore = before; ctxField = f;
    const T = { y: +d.y, m: +d.m, d: +d.d };
    const needMonth = d.hasMonth;
    let last = '', still = 0;
    for (let i = 0; i < 60; i++) {
      const st = look(before, f);
      const sig = st.view + '|' + st.opts.slice(0, 40).map(o => text(o)).join(',');
      still = sig === last ? still + 1 : 0;
      last = sig;
      trace('view', st.view, 'opts', st.opts.length, 'still', still);
      if (st.view === 'none' || still >= 3) return st.view === 'none' && i > 0 ? 'picked' : 'stuck';

      if (st.view === 'wheel') return await wheelPick(st, T, needMonth, before, f);

      if (st.view === 'year') {
        const hit = st.years.find(o => cellYear(text(o)) === T.y && !disabledCell(o));
        if (hit) {
          trace('year', T.y);
          await press(hit);
          const v = look(before, f).view;
          if (v === 'none' || (!needMonth && v !== 'year')) return 'picked';
          continue;
        }
        const dec = st.decades.find(o => { const [a, b] = cellDecade(text(o)); return T.y >= a && T.y <= b; });
        if (dec) { await press(dec); continue; }
        const ys = st.years.map(o => cellYear(text(o))).concat(st.decades.flatMap(o => cellDecade(text(o))));
        const dir = T.y < Math.min(...ys) ? -1 : 1;
        const btn = navFrom(st.years[0] || st.decades[0], dir, true);
        if (!btn) return 'stuck';
        await press(btn.b);
        continue;
      }

      if (st.view === 'month') {
        const ps = panels(st.months, st);
        const p = ps.find(x => x.head?.y === T.y) || null;
        if (p) {
          const cell = p.cells.find(c => cellMonth(text(c)) === T.m) || (p.cells.length === 12 ? p.cells[T.m - 1] : null);
          if (!cell) return 'stuck';
          if (disabledCell(cell)) return 'disabled';
          trace('month', T.y, T.m);
          await press(cell);
          await settle(80, 500);
          // 日期选择器点完月份会进入日视图，继续选日；月份选择器到此为止。
          if (look(before, f).view === 'day') continue;
          // 没有精度声明的月份框要以行为为证：点对年月后面板关闭，且回读确为该年月。
          // 只看到一个缺日的字符串不能证明它是月份框（以前会把残缺日期当成功）。
          const actual = parseDate(input?.value || readValue(f));
          if (f.kind !== 'daterange' && look(before, f).view === 'none' && actual?.hasMonth && !actual.hasDay && actual.y === d.y && actual.m === d.m) {
            d.hasDay = false;
            f.calendarPrecision = 'month';
          }
          return 'picked';
        }
        const head = ps[0]?.head;
        if (!head) return 'stuck';
        const diff = T.y - head.y;
        // 跨度大：点标题年份进入年份视图；否则逐年翻。
        if (Math.abs(diff) > 2 && await toView(head, 'year', before, f)) continue;
        const btn = navFrom(head.el, diff > 0 ? 1 : -1, true);
        if (!btn) return 'stuck';
        await press(btn.b);
        continue;
      }

      if (st.view === 'day') {
        const ps = panels(st.days, st);
        const p = ps.find(x => x.head && x.head.y === T.y && x.head.m === T.m);
        if (p) {
          const cell = p.cells.find(c => +text(c) === T.d) || (!d.hasDay ? p.cells.find(c => +text(c) === 1) : null);
          if (!cell) return 'stuck';
          if (disabledCell(cell)) return 'disabled';
          trace('day', T.y, T.m, T.d);
          await press(cell);
          await settle(80, 500);
          return 'picked';
        }
        const head = ps[0]?.head;
        if (!head || !head.m) return 'stuck';
        const diff = (T.y - head.y) * 12 + (T.m - head.m);
        // 单面板：跨年点标题进年份视图、同年跨几个月点标题进月份视图。范围面板（左右两个）只用翻页按钮，切视图会被另一侧限制。
        if (ps.length === 1 && Math.abs(diff) >= 12 && await toView(head, 'year', before, f)) continue;
        if (ps.length === 1 && Math.abs(diff) > 2 && await toView(head, 'month', before, f)) continue;
        // 范围面板：目标在左面板之前，左边往前翻；在右面板之后，右边往后翻；夹在两个面板之间（Ant v3 两侧可不相邻），左边往后翻。
        const lastHead = ps[ps.length - 1].head || head;
        const diffR = (T.y - lastHead.y) * 12 + (T.m - lastHead.m);
        // 翻年还是翻月：取点击次数少的（差 8 个月 = 翻 1 年再退 4 个月）。
        const byYear = n => Math.abs(n - 12 * Math.round(n / 12)) + Math.abs(Math.round(n / 12)) < Math.abs(n);
        let btn;
        if (diff < 0) btn = navFrom(head.el, -1, byYear(diff));
        else if (diffR > 0) btn = navFrom(lastHead.el, 1, byYear(diffR));
        else btn = navFrom(head.el, 1, false) || navFrom(lastHead.el, -1, false);
        if (!btn) return 'stuck';
        await press(btn.b);
        continue;
      }
    }
    return 'stuck';
  }
  // 点击标题里的年份 / 月份进入年份 / 月份视图（Ant、Element、Arco、iView 都支持）；没进去就返回 false。
  async function toView(head, want, before, f) {
    const re = want === 'year' ? /^(19|20)\d{2}\s*年?$/ : /^(\d{1,2}\s*月|(十[一二]?|[一二三四五六七八九十])月|[a-z]{3,9})$/i;
    const el = [head.el, ...dom.all(dom.parent(head.el), '*')].find(e => re.test(text(e)) && e.childElementCount === 0);
    if (!el) return false;
    await press(el);
    const v = look(before, f).view;
    trace('toView', want, v);
    if (v === want || (want === 'year' && v === 'month')) return true;
    if (v !== 'day') { key(document.activeElement || document.body, 'Escape'); }
    return false;
  }
  // 滚轮：每列点目标项；目标不在可见范围时点最靠近目标的一项，让列滚过去，再继续。
  async function wheelPick(st, T, needMonth, before, f) {
    const cols = [[st.years, cellYear, T.y]];
    if (needMonth) cols.push([st.months, cellMonth, T.m]);
    for (let [, read, want] of cols) {
      for (let k = 0; k < 15; k++) {
        const cur = look(before, f);
        const list = read === cellYear ? cur.years : cur.months;
        if (!list.length) break;
        const hit = list.find(o => read(text(o)) === want);
        const near = hit || list.slice().sort((a, b) => Math.abs(read(text(a)) - want) - Math.abs(read(text(b)) - want))[0];
        await press(near);
        await sleep(150);
        if (hit) break;
      }
    }
    const cur = look(before, f);
    const dayCol = cur.opts.filter(o => /^0?\d{1,2}\s*日?$/.test(text(o)));
    if (dayCol.length >= 3) {
      const hit = dayCol.find(o => parseInt(text(o)) === T.d);
      if (hit) await press(hit);
    }
    const ok = ui().newOptions(before, f).find(el => /^(确\s*定|确\s*认|完成|ok|confirm|done)$/i.test(text(el)));
    if (ok) { await press(ok); await settle(80, 500); }
    return 'picked';
  }

  // ---------- 4. 框架兜底（主环境桥） ----------
  function viaBridge(input, d, part, nth) {
    if (!input) return { ok: false, why: 'no input' };
    const id = Math.random().toString(36).slice(2);
    const root = document.documentElement;
    input.setAttribute('data-af-bridge', id);
    root.removeAttribute('data-af-bridge-result');
    try {
      document.dispatchEvent(new CustomEvent('af:bridge', { detail: JSON.stringify({ id, op: 'date', y: +d.y, m: +d.m, d: +d.d, hasDay: d.hasDay, hasMonth: d.hasMonth, part, nth }) }));
    } finally { input.removeAttribute('data-af-bridge'); }
    const raw = root.getAttribute('data-af-bridge-result');
    root.removeAttribute('data-af-bridge-result');
    try { return raw ? JSON.parse(raw) : { ok: false, why: '页面桥未加载' }; } catch { return { ok: false, why: 'bad result' }; }
  }

  // ---------- “至今”勾选框 ----------
  // 从日期控件往外找同一行里文字是“至今/在职/在读”的勾选框；碰到别的问题的输入框就停，免得勾到下一条经历。
  const NOW_BOX = /^(至今|至今在职|在职|在读|目前在职|仍在职|当前在职|present|current|till now)$/i;
  function nowBox(f) {
    let box = f.el;
    for (let i = 0; i < 4 && dom.parent(box) && dom.parent(box) !== document.body; i++) {
      box = dom.parent(box);
      const others = [...dom.all(box, 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select')]
        .filter(el => !f.nodes?.includes(el) && !dom.contains(f.el, el) && visible(el));
      const hit = [...dom.all(box, 'input[type=checkbox],[role=checkbox],[role=switch],[class*=checkbox],[class*=Checkbox],[class*=switch]')]
        .map(el => dom.closest(el, 'label') || el)
        .find(el => !dom.contains(f.el, el) && NOW_BOX.test(clean(text(el) || text(dom.parent(el)))));
      if (hit) return hit;
      if (others.length) break;
    }
    return null;
  }
  const boxChecked = el => {
    const input = el.matches('input') ? el : dom.one(el, 'input[type=checkbox]');
    if (input) return input.checked;
    return el.getAttribute('aria-checked') === 'true' || !!dom.one(el, '[aria-checked=true],[class*=checked]:not([class*=unchecked])') || /(^|[-_\s])(is-)?checked(\s|$)/.test(el.className);
  };
  const nowTicked = f => { const b = nowBox(f); return !!b && boxChecked(b); };
  async function tickNow(f) {
    const b = nowBox(f);
    if (!b) return false;
    if (boxChecked(b)) return true;
    click(b);
    await settle(40, 400);
    if (!boxChecked(b) && b.isConnected) {
      // 视觉外壳不转发点击时，直接激活原生框（和 fillChoice 同样的兜底）。
      const input = dom.one(b, 'input[type=checkbox]');
      if (input && !input.disabled) { input.click(); await settle(40, 400); }
    }
    return b.isConnected ? boxChecked(b) : true;
  }

  // ---------- 主流程 ----------
  async function fillDate(f, value, ctx) {
    const inputs = f.inputs?.length ? f.inputs : f.input ? [f.input] : [];
    const parts = f.kind === 'daterange' ? splitRange(value) : [String(value)];
    const dates = parts.map(p => NOW.test(clean(p)) ? 'now' : expectedDate(f, p));
    if (!dates.length || dates.some(d => !d)) return fail(`无法识别日期“${value}”`);
    // 刷新后的同一控件（页面可能已重渲染）
    const fresh = () => ctx.refind() || null;
    const inputAt = i => { const x = fresh(); const inp = x ? (x.inputs?.[i] || (i === 0 ? x.input : null)) : inputs[i]; return inp?.isConnected ? inp : null; };
    const current = i => {
      const x = fresh();
      const inp = x ? (x.inputs?.[i] || (i === 0 ? x.input : null)) : inputs[i];
      if (inp?.value) return inp.value;
      // 一体式范围框只有一个显示区：“2019-09 ~ 2023-06”
      const whole = x ? readValue(x) : '';
      return dates.length > 1 && (x?.inputs?.length || 0) < 2 ? splitRange(whole)[i] || '' : (i === 0 ? whole : '');
    };
    const usable = dates.map((d, i) => [d, i]).filter(([d]) => d !== 'now');
    // 一体式范围框（两个框共用一个面板、组件值是数组）：要按“开始→结束”整组重选。
    const shared = f.kind === 'daterange' && inputs.length > 1 && inputs.every(i => dom.contains(f.el, i));
    const done = () => usable.every(([d, i]) => dateOk(current(i), d));
    const bound = () => { const x = fresh(); return !x || !emptyError(x); };

    if (f.kind === 'native-date') {
      const [d] = usable[0] || [];
      if (!d) return fail('原生日期框不能填“至今”');
      for (const inp of inputs.slice(0, 1)) {
        const v = inp.type === 'month' ? `${d.y}-${d.m}` : inp.type === 'datetime-local' ? `${d.y}-${d.m}-${d.d}T00:00` : `${d.y}-${d.m}-${d.d}`;
        setValue(inp, v);
        blur(inp);
      }
      await settle(60, 400);
      return null;
    }

    const base = new Set(ui().candidates());   // 动手前的页面快照，之后所有弹层都和它比
    const nowAt = dates.indexOf('now');
    // 网申里“至今”多数是日期旁边的勾选框，日历里根本没有这一项；先勾它，勾不到再去面板里找。
    if (nowAt >= 0 && await tickNow(f)) {
      if (dates.length === 1) return { ok: true, actual: '至今' };
    }
    const findNow = async i => {
      if (!(await ui().openPopup(f, base, inputAt(i) || f.el))) return false;
      const now = ui().newOptions(base, f).find(el => NOW.test(text(el)));
      if (now) { click(now); await settle(80, 500); return true; }
      return false;
    };
    if (nowAt === 0 && dates.length === 1) {
      if (await findNow(0)) return null;
      await ui().closePopup(f, base);
      return fail('需要手动选择“至今”（或勾选旁边的“至今”）');
    }

    const tried = [];
    // 2. 键入
    const editable = inputs.length && inputs.some(i => !i.readOnly && !i.disabled);
    if (editable) {
      tried.push('键入');
      for (let k = 0; k < 4 && !(done() && bound()); k++) {
        for (const [d, i] of usable) {
          const inp = inputAt(i);
          if (!inp || inp.readOnly || dateOk(current(i), d)) continue;
          const fmt = formats(d, inp, f)[k];
          if (!fmt) continue;
          trace('type', fmt);
          await typeInto(inp, fmt);
        }
        const lastInp = inputAt(inputs.length - 1);
        if (lastInp) blur(lastInp);
        await ui().closePopup(f, base);
        await settle(80, 500);
      }
    }
    // 3. 日历面板（范围面板选完开始日不关，接着选结束日）
    if (!(done() && bound())) {
      tried.push('日历');
      const keepOpen = usable.length > 1 || nowAt > 0;
      for (let attempt = 0; attempt < 2 && !(done() && bound()); attempt++) {
        // 键入后网页可能多出了提示文字等浮动元素：重新拍快照，免得被当成“面板已打开”。
        const snap = new Set(ui().candidates());
        for (const [d, i] of usable) {
          if (!shared && dateOk(current(i), d) && bound()) continue;
          // 两个独立选择器（如京东）：选完开始日面板会自己关，等它关完再点结束框；一体的范围面板则一直开着。
          if (i > 0) await waitFor(() => !ui().newOptions(snap, fresh() || f).length, 700);
          const cur = fresh() || f;
          const r = await calendarPick(cur, inputAt(i) || cur.el, d, keepOpen, snap);
          if (cur.calendarPrecision === 'month') f.calendarPrecision = 'month';
          trace('calendar', i, r);
          await settle(100, 600);
        }
        await ui().closePopup(f, snap);
      }
    }
    // 4. 框架兜底：逐层尝试组件自己的 onChange / v-model，回读成功即停。
    if (!(done() && bound())) {
      tried.push('框架');
      for (const [d, i] of usable) {
        if (dateOk(current(i), d) && bound()) continue;
        for (let nth = 0; nth < 4; nth++) {
          const inp = inputAt(i) || (fresh() || f).el;
          const r = viaBridge(inp, d, shared || (f.kind === 'daterange' && inputs.length < 2) ? i : -1, nth);
          trace('bridge', i, nth, JSON.stringify(r));
          if (!r.ok) { if (!r.more) break; continue; }
          await settle(100, 600);
          if (dateOk(current(i), d)) break;
          if (!r.more) break;
        }
      }
      await ui().closePopup(f, base);
    }

    let nowOk = true;
    if (nowAt > 0 && !NOW.test(clean(current(nowAt))) && !nowTicked(fresh() || f)) nowOk = await findNow(nowAt);
    await ui().closePopup(f, base);
    if (!done()) return fail(`日期没有填上（已试：${tried.join('、')}），请手动选择`);
    const x = fresh();
    if (x && emptyError(x)) return fail(`网页显示了日期，但仍提示“${emptyError(x)}”，请手动重选一次`);
    if (!nowOk) return fail('开始时间已填；结束时间请手动选“至今”');
    return null;
  }

  // 核验：want 是资料里的值（单个日期或范围），actual 是网页显示。
  function matches(f, actual, want) {
    if (!actual) return false;
    const ws = f.kind === 'daterange' ? splitRange(want) : [String(want)];
    const as = f.kind === 'daterange' ? splitRange(actual) : [String(actual)];
    return ws.every((p, i) => NOW.test(clean(p)) ? !!as[i] : dateOk(as[i] || '', expectedDate(f, p)));
  }

  AF.dates = { fillDate, matches, parseDate, splitRange, emptyError, nowTicked, isNow: v => NOW.test(clean(v)) };
})();
