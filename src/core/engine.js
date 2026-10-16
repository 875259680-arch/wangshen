// 主流程：认平台 → 读字段清单 → 对应资料 → 批量写原始值 → 读回核验 → 报告/诊断。
// 认出平台（Moka、北森……）走组件直写：不点下拉、不翻日历，几十个字段一两秒。
// 认不出的网站才退回 fallback/（旧的模拟点击引擎），并把页面特征记进诊断，作为下一个要适配的平台的依据。
// 对外接口与旧引擎一致（ui/panel.js 不需要知道走的是哪条路）。
(() => {
  if (globalThis.AF?.engine) return;
  const AF = globalThis.AF;
  const dom = AF.domEngine;
  const send = dom.send;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let mode = 'dom', running = false, cancelled = false;
  let baseline = null, written = new Map();   // 学习：填写后的原始值，和我们写进去的值
  let planned = new Map(), baseText = new Map(), ignored = new Set(), lastPlatform = null, lastRun = null;
  const report = { results: [], status: '', done: 0, total: 0 };
  const listeners = new Set();
  const emit = patch => { Object.assign(report, patch); for (const l of listeners) l(report); };
  const cur = () => (mode === 'dom' ? dom.report : report);

  const COMPANY = '资料里没有对应内容，请自己填；填完点“记住”，以后自动填';
  const pageContext = () => ({ host: location.host, path: location.pathname, search: location.search });
  async function detect() { try { return await AF.rpc('detect'); } catch (_) { return null; } }

  // 旧后台的“控件种类”叫法（RESOLVE 的本地规则和 AI 提示词按它理解字段）
  const LEGACY_KIND = { text: 'text', textarea: 'textarea', number: 'text', select: 'select', bool: 'radio', date: 'date', range: 'daterange', region: 'select', multi: 'checkbox' };
  const plainOf = (plat, f) => ({ key: f.key, section: plat.section(f), label: f.label, scope: f.scope || AF.memory.pageScope(pageContext()), kind: LEGACY_KIND[plat.kind(f)] || 'text', row: f.row, part: 0,
    options: plat.options(f).map(o => o.text).slice(0, 300), required: f.required || undefined });
  // 空数组、每项都空的数组也算空（飞书“期望工作地点”空着是 []；51job 的“省 + 市”空着是 ['', '']）
  const empty = raw => raw == null || raw === '' || (Array.isArray(raw) ? raw.every(x => x == null || x === '') : typeof raw === 'object' && !Object.values(raw).some(v => v != null && v !== ''));

  const areaCache = new Map();
  async function areaTree(url) {
    const u = url.startsWith('//') ? 'https:' + url : url;
    if (!areaCache.has(u)) areaCache.set(u, AF.rpc('fetchText', u).then(t => AF.region.beisen(t)).catch(() => null));
    return areaCache.get(u);
  }

  // 字段对应资料哪一项：平台字段表 / 问题文字 → 段落兜底（“英语能力”段的“得分”）
  const targetOf = (plat, f) => plat.target(f) || AF.mapping.bySection(f.label, plat.section(f));

  // 地区选择框只能对到地区类资料（2026-10-13 中交、英诺赛科：AI 把“实习地点”认成了实习单位名称，地区表里当然找不到）
  const fitsKind = (plat, f, tgt) => plat.kind(f) !== 'region' || (!!tgt.sem && (AF.mapping.REGION_SEM.has(tgt.sem) || tgt.sem === 'cityPref'));

  async function runPlatform(id, plat, opts) {
    const t0 = performance.now();
    // 只修几项（用资料覆盖不一致的）时，在上一次的结果上更新这几项，其余照旧显示
    const results = opts.only ? (report.results || []).filter(r => !opts.only.has(r.key)) : [];
    const entryOf = f => ({ key: f.key, label: f.label, section: plat.section(f), required: f.required });
    emit({ results, status: `识别到 ${plat.name} 招聘系统，读取资料…`, done: 0, total: 0, running: true, warning: '', elapsed: 0 });
    // 北森地区表约 280KB，第一次取要一两秒：先发出去，和读资料、补条目并行。
    let early = await AF.rpc('list');
    const areaUrl = early.find(f => plat.kind(f) === 'region' && f.areaUrl)?.areaUrl;
    const areaJob = areaUrl ? areaTree(areaUrl) : null;
    const state = await send({ type: 'STATE' });
    if (state?.error) throw Error(state.error);
    const facts = AF.profile.facts(state.profile, state.supplement);
    lastRun = { facts, memories: state.memories || {} };
    if (plat.initialize && !opts.only) {
      emit({ status: '展开表单板块，读取条件字段…' });
      results.push(...await plat.initialize(facts, opts));
      early = await AF.rpc('list');
    }
    const resumeHandled = opts.only ? new Set() : await resumeFirst(plat, early, state.files || [], results);
    if (resumeHandled.size || results.some(r => r.key === 'resume-parse' && r.state === 'ok')) early = await AF.rpc('list');   // 网站解析可能自己加了条目
    // 变通：网页只有“工作经历”、没有“实习经历”，而资料里没有正式工作 → 应届生把实习经历填进工作经历。
    // 还没有条目的段落（飞书的“实习经历”开头只有“添加”）也算网页上有。
    const empties = plat.listOfGroup ? await AF.rpc('emptyGroups').catch(() => []) : [];
    const listsOnPage = new Set([...early.map(f => targetOf(plat, f)?.list), ...empties.map(e => plat.listOfGroup(e.group))].filter(Boolean));
    if (listsOnPage.has('work') && !listsOnPage.has('intern') && !facts.lists.work.length && facts.lists.intern.length) {
      facts.lists.work = facts.lists.intern;
      emit({ warning: '这个网页没有“实习经历”，已把实习经历填进“工作经历”（离职原因填“实习结束”）' });
    }
    // 应届生没有正式工作、网页也单独有实习段：工作经历段自带“没有工作经历”勾选框的，勾上（飞书），不留一条空的工作经历
    if (plat.markNone && !opts.only && !facts.lists.work.length && listsOnPage.has('work') && listsOnPage.has('intern') && plat.markNone('work')) {
      if (await AF.rpc('markNone', plat.markNone('work')).catch(() => false)) {
        results.push({ key: 'none-work', label: '工作经历', section: '工作经历', state: 'ok', value: '已勾选“没有工作经历”', source: '资料' });
        await sleep(200);
        early = await AF.rpc('list');
      }
    }
    // 资料条目比网页多：点该块的“添加”补条目（平台自己的按钮，和用户点的是同一个）。
    if (opts.expand !== false && state.autoExpand) {
      const groups = new Map();
      for (const f of early) {
        const t = targetOf(plat, f);
        if (!t?.list) continue;
        const g = groups.get(f.group) || { list: t.list, rows: 0, arg: plat.addArg(f), name: plat.section(f) };
        g.rows = Math.max(g.rows, f.row + 1);
        groups.set(f.group, g);
      }
      const added = [];
      // 还一条都没有的段落（飞书的实习、项目开头只有“添加”）：资料里有就先点一条出来，后面按条目数补齐
      if (plat.listOfGroup) {
        for (const e of empties) {
          const list = plat.listOfGroup(e.group);
          if (!list || !(facts.lists[list] || []).length || cancelled) continue;
          if (await AF.rpc('addRow', e.group).catch(() => false)) { added.push(e.title || e.group); groups.set(e.group, { list, rows: 1, arg: e.group, name: e.title }); await sleep(150); }
        }
      }
      for (const g of groups.values()) {
        const want = (facts.lists[g.list] || []).length;
        for (let i = g.rows; i < want && !cancelled; i++) {
          if (!(await AF.rpc('addRow', g.arg).catch(() => false))) break;
          added.push(g.name);
          await sleep(150);
        }
      }
      if (added.length) emit({ status: `已添加条目：${[...new Set(added)].join('、')}` });
    }
    // 段落名挂到字段上：记忆按“段落 + 问题”分区（core/memory.js）
    let fields = (await AF.rpc('list')).map(f => ({ ...f, section: plat.section(f), scope: AF.memory.pageScope(pageContext()) }));
    const d0 = new Date();
    const ctx = { facts, fields, areaTree: areaJob ? await areaJob : null, today: `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}` };
    // 平台自己的选项表（Hotjob 的地区、职能树）先取好，后面的编码、比对都是同步的
    if (plat.prepare) await plat.prepare(fields, ctx);

    // 1. 分拣：资料能直接对应的立刻写；对不上的交给记忆/AI（并行，不挡住前者）
    const direct = [], ask = [], diagItems = [], uploads = [], cityFields = [], toClassify = [], missingRows = new Map();
    const memories = state.memories || {};
    planned = new Map();
    for (const f of fields) {
      const k = plat.kind(f);
      if (opts.only && !opts.only.has(f.key)) continue;
      if (k === 'file') { if (empty(f.raw) && !resumeHandled.has(f.key)) uploads.push(f); continue; }
      if (k === 'consent' || f.disabled) continue;
      if (plat.companion?.(f)) continue;
      if (k === 'unknown') {
        results.push({ ...entryOf(f), state: 'nodata', reason: '尚未适配该控件类型，已记录诊断' });
        continue;
      }
      if (!empty(f.raw) && !opts.overwrite) {
        // 不覆盖，但和资料比一比：旧草稿、网站解析简历带进来的错值（生日差 10 天、实习时间全是 1 月）单独列出来
        const want = diffOf(plat, id, f, facts, memories, ctx);
        const unverified = k === 'textarea' && !targetOf(plat, f) && !AF.memory.lookupMap(memories, id, f);
        results.push(want ? { ...entryOf(f), state: 'diff', reason: `网页上是“${plat.decode(f, f.raw).slice(0, 24)}”，资料是“${want.slice(0, 24)}”` }
          : unverified ? { ...entryOf(f), state: 'extra', reason: '网页已有文本，资料没有可直接核对的原文，请检查是否适合本次申请' } : { ...entryOf(f), state: 'kept' });
        continue;
      }
      let tgt = targetOf(plat, f), via = '资料';
      // 记忆优先：资料对不上的问题查“固定回答”，再查以前认过的“这题对应资料哪一项”（AI 认题 / 人工）
      if (!tgt) {
        planned.set(f.key, { mapped: false });
        const m = AF.memory.lookup(memories, id, f, null);
        if (m != null) { direct.push({ f, value: m, source: '记忆' }); continue; }
        let mp = AF.memory.lookupMap(memories, id, f);
        // 经历/家庭块里的题对到本人的单值资料是错的（旧版 AI 认过这种），作废重认
        if (mp && mp.sem && plat.listOf(f)) mp = undefined;
        if (mp && !fitsKind(plat, f, mp)) mp = undefined;
        if (mp) { tgt = mp; via = 'AI 认题'; }
        else if (AF.mapping.aiAllowed(plat.kind(f))) { ask.push(f); continue; }
        else if (mp === null) { results.push({ ...entryOf(f), state: 'nodata', reason: COMPANY }); continue; }
        else { toClassify.push(f); continue; }
      }
      if (tgt.sem === 'cityPref') { planned.set(f.key, { mapped: true, city: true }); cityFields.push(f); continue; }
      if (tgt.sem && f.row > 0 && tgt.sem !== 'cityPref' && !tgt.perRow) { results.push({ ...entryOf(f), state: 'nodata', reason: COMPANY }); continue; }   // 单值资料只填第 1 条
      const v = AF.mapping.valueOf(tgt, facts, f.row);
      planned.set(f.key, { mapped: true, from: v != null && typeof v !== 'object' ? v : null, objectValue: !!v && typeof v === 'object' });
      // 网页上这一条经历资料里没有（如网页有“工作经历”而你只有实习）：整条合并成一项提示，不逐个字段列
      if (v === undefined) {
        const g = `${f.group}|${f.row}`, cur = missingRows.get(g);
        if (cur) cur.required ||= f.required;
        else missingRows.set(g, { key: f.key, label: `${plat.section(f) || '经历'} 第 ${f.row + 1} 条`, section: plat.section(f), required: f.required, state: 'nodata', reason: '资料里没有这一条，留空即可（也可以在网页上删掉这一条）' });
        continue;
      }
      if (v === '' || v == null) {
        const m = AF.memory.lookup(memories, id, f, null);
        if (m != null) direct.push({ f, value: m, source: '记忆' }); else results.push({ ...entryOf(f), state: 'nodata' });
        continue;
      }
      const m = AF.memory.lookup(memories, id, f, v);
      const k2 = plat.kind(f);
      if (m != null) direct.push({ f, value: m, source: '记忆' });
      else direct.push({ f, tgt, value: AF.mapping.REGION_SEM.has(tgt.sem) && (k2 === 'text' || k2 === 'textarea') ? AF.mapping.regionText(f.label, v) : v, source: via });
    }
    results.push(...missingRows.values());
    // 意向城市：按优先级挑网页上有的；同一页有几个意向城市框就依次填不同的城市
    // 保留已有志愿时，也要占用其城市；否则补第 2 个空框会再次填第 1 志愿。
    const usedCities = new Set(opts.overwrite ? [] : fields.filter(f => targetOf(plat, f)?.sem === 'cityPref' && !empty(f.raw))
      .flatMap(f => plat.decode(f, f.raw).split(/[、,/]/).filter(Boolean).slice(-1)).map(AF.region.core));
    for (const f of cityFields) {
      const m = AF.memory.lookup(memories, id, f, null);
      const pick = m != null ? m : AF.mapping.pickCity(plat.kind(f), plat.options(f).map(o => o.text), facts.cityPrefs.length ? facts.cityPrefs : [facts.currentCity].filter(Boolean), usedCities, plat.kind(f) === 'region' ? ctx.areaTree || AF.region.gb() : null);
      if (pick) { usedCities.add(AF.region.core(pick)); direct.push({ f, value: pick, source: m != null ? '记忆' : '城市优先级' }); }
      else {
        const opts = plat.options(f).map(o => o.text);
        const prefs = facts.cityPrefs.length ? facts.cityPrefs.slice(0, 4).join('、') : `${facts.currentCity || '未设'}（还没设意向城市优先级，暂按现居城市）`;
        results.push({ ...entryOf(f), state: 'nodata', reason: `你的意向城市：${prefs}${opts.length ? `；网页选项只有：${opts.slice(0, 6).join('、')}${opts.length > 6 ? '…' : ''}` : ''}。请自己选，选完点“记住”会加进优先级` });
      }
    }
    emit({ total: direct.length + ask.length, status: `填写 ${direct.length} 个字段…` });
    const page = { ...pageContext(), title: document.title };
    const aiJob = ask.length ? send({ type: 'RESOLVE', fields: ask.map(f => plainOf(plat, f)), page }) : null;
    // AI 认题和直接填写并行：先填资料能对上的，同时问 AI 剩下的题各对应资料哪一项
    const classifyJob = toClassify.length ? send({ type: 'CLASSIFY', fields: toClassify.map(f => ({ ...plainOf(plat, f), list: plat.listOf(f) })) }) : null;

    // 2. 编码并批量写入。选项对不上的（“C1”对“C照”、区间类）请 AI 在选项里挑。
    const pending = [];   // { f, raw, value, source }
    const encodeAll = async items => {
      for (const it of items) {
        // 只能从网站字典里选的（Hotjob 的学校、专业）：先按值去网站搜，候选给 encode 挑
        if (plat.lookup) await plat.lookup(it.f, it.value, ctx);
        let enc = plat.encode(it.f, it.value, ctx);
        // 对不上时先退一级（工商管理类 → 管理学），再请 AI 挑
        if (enc.pick && it.tgt) for (const alt of AF.mapping.alternatives(it.tgt, facts, it.f.row)) {
          const e2 = plat.encode(it.f, alt, ctx);
          if (e2.raw !== undefined) { enc = e2; break; }
        }
        if (enc.pick) {
          const r = await send({ type: 'PICK', field: plainOf(plat, it.f), value: typeof it.value === 'object' ? JSON.stringify(it.value) : String(it.value), options: enc.pick });
          const opt = Number.isInteger(r?.index) && r.index >= 0 ? plat.options(it.f)[r.index] : null;
          enc = opt ? plat.encode(it.f, opt.text, ctx) : { error: `选项里没有“${it.value}”` };
        }
        if (enc.skip) { results.push({ ...entryOf(it.f), state: 'nodata', reason: enc.skip }); continue; }
        if (enc.raw !== undefined) {
          pending.push({ ...it, raw: enc.raw, note: enc.note });
          for (const extra of enc.additional || []) {
            const f = fields.find(x => x.key === extra.key);
            if (f && (empty(f.raw) || opts.overwrite)) pending.push({ f, raw: extra.raw, value: extra.value, source: it.source });
          }
        }
        else { results.push({ ...entryOf(it.f), state: 'fail', value: String(it.value), reason: enc.error || '无法转换' }); diagItems.push(diagOf(it.f, 'encode', enc.error)); }
      }
    };
    const diagOf = (f, stage, reason) => ({ platform: id, key: f.key, id: f.id, type: f.type, kind: plat.kind(f), label: f.label, section: plat.section(f), row: f.row, stage, reason, optionsCount: (f.options || []).length });
    const flush = async () => {
      if (!pending.length || cancelled) return;
      const batch = pending.splice(0);
      const res = await AF.rpc('writeMany', batch.map(x => ({ key: x.f.key, raw: x.raw })));
      const errs = new Map(res.filter(r => !r.ok).map(r => [r.key, r.error]));
      await sleep(120);   // 等 React 把新值渲染回组件 props，再回读
      const fresh = new Map((await AF.rpc('list')).map(f => [f.key, f]));
      for (const x of batch) {
        const now = fresh.get(x.f.key);
        const ok = !errs.has(x.f.key) && now && plat.same(now, now.raw, x.raw);
        if (ok) { written.set(x.f.key, now.raw); results.push({ ...entryOf(x.f), state: 'ok', value: plat.decode(now, now.raw), want: x.value, source: x.source, reason: x.note }); }
        else {
          const reason = errs.get(x.f.key) || (now ? `网页没有接受该值（现在是“${plat.decode(now, now.raw).slice(0, 20) || '空'}”）` : '字段不见了');
          results.push({ ...entryOf(x.f), state: 'fail', value: String(typeof x.value === 'object' ? plat.decode(x.f, x.raw) : x.value), reason });
          diagItems.push(diagOf(x.f, 'verify', reason));
        }
      }
      emit({ results, done: results.filter(r => r.state === 'ok' || r.state === 'fail').length });
    };
    await encodeAll(direct);
    await flush();
    if (uploads.length && !cancelled) await uploadFiles(plat, uploads, results, entryOf, state.files || []);

    // 2.5 AI 认题回来：认出的从资料取值写入，认不出的记成“资料里没有”，下次不再问；结果都存成规则，可在设置页查看/删除
    if (classifyJob && !cancelled) {
      emit({ status: `AI 正在认 ${toClassify.length} 个不认识的问题…` });
      const r = await classifyJob;
      const items = [], rules = [];
      for (const f of toClassify) {
        let key = r?.map?.[f.key];
        if (key && !key.includes('.') && plat.listOf(f)) key = null;   // 块里的题不能对到本人单值资料
        if (key && !fitsKind(plat, f, key.includes('.') ? { list: key.split('.')[0], prop: key.split('.')[1] } : { sem: key })) key = null;
        if (r?.offline || key === undefined) { results.push({ ...entryOf(f), state: 'nodata', reason: COMPANY }); continue; }
        rules.push(AF.memory.makeMap({ ...f, section: plat.section(f) }, id, key, 'AI', location.host));
        if (!key) { results.push({ ...entryOf(f), state: 'nodata', reason: COMPANY }); continue; }
        const [a, b] = key.split('.'), tgt = b ? { list: a, prop: b } : { sem: a };
        planned.set(f.key, { mapped: true, ai: key });
        let v = tgt.sem === 'cityPref'
          ? AF.mapping.pickCity(plat.kind(f), plat.options(f).map(o => o.text), facts.cityPrefs, usedCities, plat.kind(f) === 'region' ? ctx.areaTree || AF.region.gb() : null)
          : AF.mapping.valueOf(tgt, facts, f.row);
        if (v == null || v === '') { results.push({ ...entryOf(f), state: 'nodata', reason: `AI 认为这题是“${key}”，但资料里没有` }); continue; }
        items.push({ f, value: v, source: 'AI 认题' });
      }
      if (rules.length) send({ type: 'MEM_SAVE', items: rules });
      await encodeAll(items);
      await flush();
    }

    // 3. AI / 记忆回来后补写
    if (aiJob && !cancelled) {
      emit({ status: `AI 正在回答 ${ask.length} 个资料里没有直接对应的问题…` });
      const res = await aiJob;
      if (res?.error) emit({ warning: res.error });
      const values = res?.values || {}, source = res?.source || {}, offline = new Set(res?.offline || []);
      const items = [];
      for (const f of ask) {
        const v = values[f.key];
        if (v == null || v === '') {
          results.push({ ...entryOf(f), state: offline.has(f.key) ? 'fail' : 'nodata', reason: offline.has(f.key) ? 'AI 不可用，本地规则认不出这个问题，请手动填写' : undefined });
          diagItems.push(diagOf(f, 'unmapped', offline.has(f.key) ? 'AI 不可用' : 'AI 无答案'));
          continue;
        }
        items.push({ f, value: v, source: source[f.key] || 'AI' });
        if (source[f.key] === 'AI') diagItems.push(diagOf(f, 'ai', '由 AI 回答（可考虑加入对应表）'));
      }
      await encodeAll(items);
      await flush();
    }

    // 4. 标出需要人工处理的，记诊断，记基准（之后用户手改的才算“学习”）
    const need = results.filter(r => r.state === 'fail' || (r.state === 'nodata' && r.required)).map(r => r.key);
    AF.rpc('mark', need).catch(() => {});
    const logged = new Set(diagItems.map(x => x.key));
    for (const r of results) {
      if (logged.has(r.key) || !['nodata', 'fail', 'diff', 'extra'].includes(r.state)) continue;
      const f = fields.find(x => x.key === r.key);
      diagItems.push(f ? diagOf(f, r.state === 'fail' ? 'error' : 'nodata', r.state === 'diff' ? '网页已有内容与资料不一致' : r.reason || '资料中没有对应内容')
        : { platform: id, key: r.key, label: r.label, section: r.section, stage: r.state === 'fail' ? 'error' : 'nodata', reason: r.reason });
    }
    AF.diag.record(diagItems, { host: location.host });
    await snapshot(plat);
    const ok = results.filter(r => r.state === 'ok').length, bad = results.filter(r => r.state === 'fail').length, nodata = results.filter(r => r.state === 'nodata').length;
    const elapsed = +((performance.now() - t0) / 1000).toFixed(1);
    emit({ results, elapsed, status: cancelled ? '已停止' : `完成：填写 ${ok} 项，失败 ${bad} 项，无资料 ${nodata} 项` });
  }

  // ---------- 网页已有值与资料不一致 ----------
  // 返回资料应填的文字；一致、对不上资料、或无法比较时返回 null（宁可漏报，不误报）
  function diffOf(plat, id, f, facts, memories, ctx) {
    const k = plat.kind(f);
    if (['file', 'consent', 'unknown'].includes(k)) return null;
    // 只拿确定的对应（平台字段表、规则表）来判“不一致”；AI 认题拿来填空可以，拿来指认网页错了不够格
    const tgt = targetOf(plat, f);
    if (!tgt) return null;
    if (tgt.sem && f.row > 0) return null;   // 单值资料只对应第 1 条（网站解析出的技能 2、3… 条不该拿整句技能去比）
    if (tgt.sem === 'cityPref' || tgt.sem === 'declareNo') return null;   // 多答案 / 默认值：不算错
    // 证书是一堆没有先后的条目，网页上多一张资料里没写的（CET-6 写在资料的语言能力里）不是填错了
    if (tgt.list === 'cert') return null;
    let v = AF.mapping.valueOf(tgt, facts, f.row);
    if (v == null || v === '') return null;
    const m = typeof v === 'object' ? null : AF.memory.lookup(memories, id, f, v);
    if (m != null) v = m;
    else if (AF.mapping.REGION_SEM.has(tgt.sem) && (k === 'text' || k === 'textarea')) v = AF.mapping.regionText(f.label, v);
    const enc = plat.encode(f, v, ctx);
    if (enc.raw === undefined || enc.raw?.now) return null;
    if (plat.same(f, f.raw, enc.raw)) return null;
    // 只是条目顺序和资料不同（证书第 1 条是 CET-6、资料第 1 条是普通话）：网页上的值是资料里另一条的，不算错（2026-10-13 Hotjob）
    if (tgt.list && tgt.row == null && (facts.lists[tgt.list] || []).some((it, i) => {
      if (i === f.row) return false;
      const e = plat.encode(f, AF.mapping.valueOf(tgt, facts, i) ?? '', ctx);
      return e.raw !== undefined && plat.same(f, f.raw, e.raw);
    })) return null;
    // 只差标点、项目符号、全半角、换行的不算不一致（网站把“：”存成“:”、开头加“▪”）
    const bare = t => String(t).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const a = bare(plat.decode(f, f.raw)), b = bare(plat.decode(f, enc.raw));
    if (a === b) return null;
    if ((k === 'textarea' || k === 'text') && a.length > 30 && b.length > 30 && a.slice(0, 30) === b.slice(0, 30)) return null;
    return plat.decode(f, enc.raw) || String(v);
  }

  // ---------- 简历：先传、等网站解析完再填 ----------
  // 很多网申页顶部有“上传简历，帮你快速解析”，Moka 的简历字段也写着“上传后会自动解析、填充申请表”。
  // 这类上传会让网站用简历改写表单，必须排在最前面：先传、等解析完，插件再补空白、列出解析错的值。
  // 3.3.0 把顶部这个入口漏了（它不是表单字段），“上传材料”在这类页面上直接说“没有上传框”。
  const RESUME = /简历|resume|\bcv\b/i, PARSES = /解析|自动填|快速填写|导入简历|识别/;
  function parseZones() {
    return [...document.querySelectorAll('input[type=file]')].filter(i => {
      if (i.disabled || i.files.length || i.closest('#af-panel-host')) return false;
      let t = '';
      for (let c = i.parentElement, k = 0; c && k < 6 && !t.trim(); c = c.parentElement, k++) t = c.innerText || '';
      return RESUME.test(t) && PARSES.test(t);
    });
  }
  function domUpload(input, file) {
    const bin = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.mime }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const filledCount = (plat, list) => list.filter(f => !['file', 'consent', 'unknown'].includes(plat.kind(f)) && !empty(f.raw)).length;
  async function resumeFirst(plat, early, files, results) {
    const fields = early.filter(f => plat.kind(f) === 'file' && empty(f.raw) && RESUME.test(f.label) && PARSES.test(f.hint || ''));
    const zones = parseZones();
    const handled = new Set(fields.map(f => f.key));
    if (!fields.length && !zones.length) return handled;
    const key = fields[0]?.key || 'resume-parse', label = fields[0]?.label || '上传简历（网站自动解析）';
    const resume = files.find(f => f.kind === '简历');
    if (!resume) { results.push({ key, label, section: '', required: true, state: 'nodata', reason: '还没有存简历：在“资料与设置 → 材料”里添加' }); return handled; }
    // Hotjob 的“上传文件简历”解析完直接存进你在网站上的简历（不用点保存），会把已存的学校、专业、证书改掉
    // （2026-10-13 实测踩过）。这类网站一键填写绝不自动传，要用网站解析请自己点“上传材料”。
    if (plat.parseSaves) {
      results.push({ key, label, section: '', state: 'nodata', reason: '这个网站解析简历后会直接改写你存在网站上的简历，插件不自动上传；需要时点“上传材料”' });
      return handled;
    }
    const before = filledCount(plat, early);
    if (before > 3) {
      results.push({ key, label, section: '', state: 'nodata', reason: '网页已有内容，没有自动上传简历（网站解析会改写已填的内容）；需要时点“上传材料”' });
      return handled;
    }
    emit({ status: '先上传简历，等网站解析…' });
    const file = await send({ type: 'GET_FILE', id: resume.id });
    if (!file?.base64) { results.push({ key, label, section: '', state: 'fail', reason: '简历文件读不出来' }); return handled; }
    for (const f of fields) await AF.rpc('upload', f.key, { name: file.name, mime: file.mime, base64: file.base64 }).catch(() => {});
    for (const z of parseZones()) domUpload(z, file);   // 平台字段和顶部入口是同一个上传框时，上一步已经放了文件，这里自动跳过
    // 等解析：已填字段数涨上去、并稳定 1.5 秒；最长 15 秒
    let last = before, stable = 0, grew = false;
    for (let t = 0; t < 30 && !cancelled; t++) {
      await sleep(500);
      const n = filledCount(plat, await AF.rpc('list').catch(() => []));
      if (n > before) grew = true;
      stable = n === last ? stable + 1 : 0; last = n;
      if (grew && stable >= 3) break;
    }
    results.push({ key, label, section: '', state: 'ok', value: grew ? `已上传 ${file.name}，网站解析填了 ${last - before} 项` : `已上传 ${file.name}（网站没有解析出内容）`, source: '材料' });
    return handled;
  }

  // ---------- 材料上传 ----------
  // 按上传框的名称匹配你在“资料与设置 → 材料”里放的文件（core/files.js），文件内容按需从后台取。
  async function uploadFiles(plat, list, results, entryOf, files) {
    emit({ status: `上传材料（${list.length} 个上传框）…` });
    const started = [];
    for (const f of list) {
      if (cancelled) break;
      const m = AF.files.match(f.label, files);
      if (!m) { results.push({ ...entryOf(f), state: 'nodata', reason: AF.files.kindOf(f.label) ? `还没有上传“${AF.files.kindOf(f.label)}”，可在“资料与设置 → 材料”里添加` : '没有对应的材料' }); continue; }
      try {
        const file = await send({ type: 'GET_FILE', id: m.id });
        if (!file?.base64) throw Error('材料文件读不出来');
        await AF.rpc('upload', f.key, { name: file.name, mime: file.mime, base64: file.base64 });
        started.push({ f, name: file.name });
      } catch (e) { results.push({ ...entryOf(f), state: 'fail', reason: `上传失败：${e.message || e}` }); }
    }
    // 网页收到文件后要传到它自己的服务器，几秒后字段里才有值：全部发出后一起等，以字段真的有值为准
    const pending = new Map(started.map(x => [x.f.key, x]));
    const uploadWaitMs = plat.uploadTimeoutMs || 15000;
    for (let t = 0; t < Math.ceil(uploadWaitMs / 500) && pending.size && !cancelled; t++) {
      await sleep(500);
      const now = new Map((await AF.rpc('list').catch(() => [])).map(f => [f.key, f]));
      for (const [k, x] of pending) if (now.get(k) && !empty(now.get(k).raw)) { results.push({ ...entryOf(x.f), state: 'ok', value: `已上传 ${x.name}`, source: '材料' }); pending.delete(k); }
    }
    for (const x of pending.values()) results.push({ ...entryOf(x.f), state: 'nodata', reason: `已交给网站，${uploadWaitMs / 1000} 秒内尚未收到上传完成回执；状态未确认，再次填写会重新检查` });
    emit({ results });
  }
  async function uploadOnly() {
    const id = await detect(), plat = id && AF.platforms[id];
    if (!plat) return dom.uploadResume();
    const state = await send({ type: 'STATE' });
    const fields = (await AF.rpc('list')).filter(f => plat.kind(f) === 'file' && empty(f.raw));
    const results = [];
    await uploadFiles(plat, fields, results, f => ({ key: f.key, label: f.label, section: plat.section(f), required: f.required }), state.files || []);
    const zones = parseZones(), resume = (state.files || []).find(f => f.kind === '简历');
    // 解析即保存的网站（Hotjob）：传之前问一句，网站会改写已存的简历
    const go = !zones.length || !resume || !plat.parseSaves || confirm('这个网站会用简历的解析结果直接改写你存在网站上的简历（学校、专业、证书等，不用点保存就生效）。确定上传简历？');
    if (zones.length && go) {
      if (!resume) results.push({ label: '上传简历（网站自动解析）', state: 'nodata', reason: '还没有存简历，在“资料与设置 → 材料”里添加' });
      else { const file = await send({ type: 'GET_FILE', id: resume.id }); for (const z of zones) domUpload(z, file); results.push({ label: '简历（网站自动解析）', state: 'ok' }); }
    }
    const ok = results.filter(r => r.state === 'ok');
    return ok.length ? { ok: true, actual: ok.map(r => r.label).join('、') } : { ok: false, reason: results.map(r => `${r.label}：${r.reason}`).join('；') || '页面上没有空着的上传框' };
  }

  async function run(opts = {}) {
    if (running || dom.running) return cur();
    cancelled = false;
    let id = await detect();
    // 认得的招聘网站上表单还没渲染出来（页面刚打开就点了）：等一会儿再认，最多 15 秒（飞书投递页实测 10.6 秒才出表单）。
    // 以前这时会静悄悄地“填 0 项”。
    const known = /(^|\.)(zhiye\.com|mokahr\.com|hotjob\.cn|jobs\.feishu\.cn|51job\.com)$/.test(location.hostname);
    for (let i = 0; !id && known && i < 30 && !cancelled; i++) { emit({ status: `等网页加载完…（${Math.ceil((30 - i) / 2)} 秒）`, running: true }); await sleep(500); id = await detect(); }
    const plat = id && AF.platforms[id];
    if (!plat) {
      if (known) emit({ running: false, status: '' });
      mode = 'dom';
      const r = await dom.run(opts);
      if (!(r.results || []).length) {
        r.status = known ? '没找到可以填的表单：网页可能还没加载完，或要先点开某张卡片的“编辑 / 添加”。稍等再点一次' : '这个页面上没找到可以填的表单';
        for (const l of listeners) l(r);
      }
      // 没认出平台的页面：失败项连同页面特征记下来，决定下一个该适配哪家。
      const diagnostics = (r.results || []).filter(x => ['fail', 'nodata'].includes(x.state)).map(x => ({ platform: null, key: x.key, label: x.label, section: x.section, stage: x.state === 'fail' ? 'dom' : 'unmapped', reason: x.reason }));
      if (!(r.results || []).length) diagnostics.push({ stage: 'unknown', reason: '未识别到可填写表单，可能需要展开板块或等待页面加载' });
      AF.diag.record(diagnostics);
      return r;
    }
    mode = 'platform'; running = true; cancelled = false;
    try { await runPlatform(id, plat, opts); }
    catch (e) { emit({ status: '出错：' + (e.message || e) }); AF.diag.record([{ platform: id, stage: 'error', reason: '填写流程中断：' + (e.message || e) }]); }
    finally { running = false; emit({ running: false, edits: [] }); }
    return report;
  }

  // ---------- 学习：用户在我们填完后亲手改的字段 ----------
  // 逐条列出“原来 → 现在”，用户一条条点“记住/忽略”。记成什么由 core/memory.js 决定。
  async function snapshot(plat) {
    const now = await AF.rpc('list').catch(() => []);
    baseline = new Map(now.map(f => [f.key, JSON.stringify(f.raw)]));
    baseText = new Map(now.map(f => [f.key, plat.decode(f, f.raw)]));
  }
  async function edits() {
    if (mode === 'dom') return dom.edits();
    if (!baseline) return [];
    const id = await detect(), plat = id && AF.platforms[id];
    if (!plat) return [];
    lastPlatform = id;
    const now = (await AF.rpc('list').catch(() => [])).map(f => ({ ...f, section: plat.section(f), scope: AF.memory.pageScope(pageContext()) }));
    // 上传框不算“手动修改”：材料上传是异步完成的，会晚于填完时的快照
    return now.filter(f => !empty(f.raw) && baseline.get(f.key) !== JSON.stringify(f.raw) && !['file', 'consent', 'unknown'].includes(plat.kind(f)))
      .map(f => {
        // 现算这个字段对应资料哪一项（不能只看上一轮写过什么：已有值被保留的字段上一轮根本没记，
        // 以前这样会把“资料是 X 时填 Y”错存成固定回答，换算规则永远不生效）
        const p = mappingOf(plat, id, f);
        const after = plat.decode(f, f.raw);
        return { key: f.key, platform: id, id: f.id, label: f.label, section: plat.section(f), scope: f.scope, row: f.row, kind: plat.kind(f),
          before: baseText.get(f.key) || '', after, value: after, from: p.mapped ? p.from : null,
          // 起止时间这类对应资料里一整段经历的，改了说明资料本身要改，不记成规则
          city: !!p.city, fill: p.fill || null, learnable: !p.objectValue && !!after, why: p.objectValue ? '这是资料里的经历时间，请直接改资料' : '' };
      })
      .filter(x => x.after && !ignored.has(x.key + '=' + x.after));
  }
  function mappingOf(plat, id, f) {
    const facts = lastRun?.facts, memories = lastRun?.memories || {};
    let tgt = targetOf(plat, f);
    if (!tgt) { const mp = AF.memory.lookupMap(memories, id, f); if (mp && !(mp.sem && plat.listOf(f))) tgt = mp; }
    if (!tgt || !facts) return { mapped: false };
    if (tgt.sem === 'cityPref') return { mapped: true, city: true };
    const v = AF.mapping.valueOf(tgt, facts, f.row);
    // 资料这项是空的（GPA 没填）：你在网页上填了，就补进资料（所有网站通用）；对到“没有”这类的照旧记固定回答
    if (v === '' && tgt.sem !== 'none' && tgt.sem !== 'declareNo' && !(tgt.list && !(facts.lists[tgt.list] || [])[tgt.row ?? f.row])) {
      return { mapped: false, fill: tgt.sem ? `sem.${tgt.sem}` : `${tgt.list}.${tgt.row ?? f.row}.${tgt.prop}` };
    }
    if (v == null || v === '') return { mapped: false };   // 资料这项是空的：记成固定回答
    return { mapped: true, from: typeof v === 'object' ? null : v, objectValue: typeof v === 'object' };
  }
  let editTimer = 0;
  for (const type of ['change', 'input', 'click', 'keyup']) {
    document.addEventListener(type, e => {
      if (mode !== 'platform' || !e.isTrusted || running || !baseline) return;
      clearTimeout(editTimer);
      editTimer = setTimeout(async () => emit({ edits: await edits() }), 900);
    }, true);
  }
  // items 省略 = 全部记住
  async function learn(items) {
    if (mode === 'dom') return dom.learn();
    const list = (items || await edits()).filter(x => x.learnable);
    if (!list.length) return 0;
    // 意向城市不记成某一题的答案，而是加进城市优先级（所有网站共用）
    const cities = list.filter(x => x.city).map(x => x.after.split('/').pop());
    if (cities.length) await send({ type: 'CITY_ADD', cities });
    const fills = list.filter(x => x.fill && !x.city && x.kind !== 'select');
    if (fills.length) await send({ type: 'SUPPLEMENT_SAVE', items: fills.map(x => ({ key: x.fill, value: x.after, label: x.label, host: location.host })) });
    const r = await send({ type: 'MEM_SAVE', items: list.filter(x => !x.city && !fills.includes(x)).map(x => AF.memory.make(x, location.host)) });
    for (const x of list) ignored.add(x.key + '=' + x.after);   // 已记住的不再列出
    emit({ edits: await edits() });
    return (r?.saved || 0) + cities.length + fills.length;
  }
  async function ignore(item) {
    ignored.add(item.key + '=' + item.after);
    emit({ edits: await edits() });
  }

  AF.engine = {
    run, learn, ignore, get mode() { return mode; },
    // 只用资料覆盖“与资料不一致”的这几项，别的不动
    fixDiffs: keys => run({ overwrite: true, expand: false, only: new Set(keys) }),
    focus: key => (mode === 'platform' ? (AF.rpc('focus', key).catch(() => false), true) : dom.focus(key)),
    uploadResume: () => uploadOnly(),
    ensureBaseline: () => { if (mode === 'dom') dom.ensureBaseline(); },
    edits,
    cancel: () => { cancelled = true; dom.cancel(); },
    subscribe: fn => { listeners.add(fn); const off = dom.subscribe(r => { if (mode === 'dom') fn(r); }); return () => { listeners.delete(fn); off(); }; },
    exportDiag: () => send({ type: 'DIAG_EXPORT' }),
    get report() { return cur(); }, get running() { return running || dom.running; },
    send,
  };
})();
