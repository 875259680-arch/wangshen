// 前程无忧 51job 校招“简历展示页”（新样式：xyz.51job.com/consumer/pc/resume/index）页面侧。
// 页面是 Vue 2 + Element UI：每张卡片点“编辑/添加”后出现一个编辑器组件，身上有 fields（字段定义：colName、中文名、editStyle、字典 items）
// 和 formData（按 colName 存值）。和经典录入页同一个后台，colName 就是经典页的 dlcolname（小写）。
// 值的格式（2026-10-13 汉高投递页）：文字是字符串；下拉是字典 value（性别 "0"）；两级下拉存第二级的 value（上海 "020000"）；
// 日期是 "YYYY-MM-DD 00:00:00"。卡片先通过网站自己的编辑入口展开，再读字段；不自动保存。
(() => {
  const P = window.__afPage;
  if (!P) return;
  // 打开着的编辑器：从 Element UI 的 el-form 往上找带 fields + formData 的组件
  function editors() {
    const out = [];
    for (const form of document.querySelectorAll('.el-form')) {
      if (!form.getClientRects().length) continue;
      for (let vm = form.__vue__; vm; vm = vm.$parent) {
        if (vm.fields && typeof vm.fields === 'object' && vm.formData && typeof vm.formData === 'object') { if (!out.includes(vm)) out.push(vm); break; }
      }
    }
    return out;
  }
  const fieldsOf = E => Object.values(E.fields || {}).filter(f => f && f.colName && f.isShow !== false);
  const cards = () => [...document.querySelectorAll('.resume-module')].map(el => {
    const vm = el.__vue__?.$parent;
    return vm?.info?.modName && typeof vm.handleTopClick === 'function' ? { el, vm, info: vm.info } : null;
  }).filter(Boolean);
  function owner(E) {
    for (let vm = E.$parent; vm; vm = vm.$parent) if (vm.info?.modName === E.module?.modName && 'detailData' in vm) return vm;
    return null;
  }
  // 多条目卡片（教育、实习……）编辑的是第几条：编辑已有的按它在卡片里的位置；“添加”是追加在最后
  function rowOf(E) {
    if (E.module?.modType !== 2) return 0;
    const host = owner(E), cur = E.data || E.$props?.data;
    const i = Array.isArray(host?.detailData) ? host.detailData.indexOf(cur) : -1;
    if (i >= 0) return i;
    const list = host?.data;
    if (Array.isArray(list)) return E.type === 'add' ? list.length : Math.max(0, list.indexOf(cur));
    return 0;
  }
  function describe(E, f) {
    const mod = E.module || {}, items = f.items || [];
    const raw = E.formData[f.colName] ?? null;
    const selected = items.find(i => String(i.value) === String(raw)) || items.flatMap(i => i.items || []).find(i => String(i.value) === String(raw));
    const input = [11, 18].includes(+f.editStyle) ? itemOf({ E, f })?.querySelector('input') : null;
    const uiMatchesRaw = ![11, 18].includes(+f.editStyle) || raw == null || raw === '' || !!(selected && input?.value.includes(String(selected.name)));
    return { key: `${mod.modName || ''}|${rowOf(E)}|${f.colName}`, id: f.colName, group: mod.modName || '', groupTitle: mod.cname || E.$parent?.$props?.title || '',
      row: rowOf(E), multi: mod.modType === 2, type: 'es' + f.editStyle, label: f.cname || '', required: !!f.isMustUsed, dict: f.dictTable || '',
      options: items.map(i => ({ text: String(i.name), value: i.value, children: (i.items || []).map(c => ({ text: String(c.name), value: c.value })) })), hasTree: items.some(i => i.items && i.items.length),
      raw, uiMatchesRaw };
  }
  const itemOf = x => [...x.E.$el.querySelectorAll('.el-form-item')].find(i => (i.querySelector('.el-form-item__label')?.innerText || '').replace(/[\s*]/g, '') === String(x.f.cname).replace(/[\s*]/g, ''));
  function autocompleteOf(x) {
    const inp = itemOf(x)?.querySelector('input');
    let vm = null; for (let el = inp; el && !vm; el = el.parentElement) vm = el.__vue__;
    for (; vm; vm = vm.$parent) if (typeof vm.handleSelect === 'function' && 'hasSelect' in vm) return vm;
    return null;
  }
  function twoLayersOf(x) {
    const item = itemOf(x);
    for (const el of item?.querySelectorAll('.jbs_select_panel') || []) {
      for (let vm = el.__vue__; vm && vm !== x.E; vm = vm.$parent) {
        if (vm.$options.name === 'TwoLayers' && typeof vm.initCheckedVal === 'function') return vm;
      }
    }
    return null;
  }
  const all = () => editors().flatMap(E => fieldsOf(E).map(f => ({ E, f, d: describe(E, f) })));
  const byKey = () => new Map(all().map(x => [x.d.key, x]));

  P.register({
    id: 'job51v',
    detect: () => /(^|\.)51job\.com$/.test(location.hostname) && (editors().length > 0 || cards().length > 0),
    sections: () => cards().map(({ vm, info }) => ({ group: info.modName, title: info.cname,
      multi: info.modType === 2, count: Array.isArray(vm.data) ? vm.data.length : 1 })),
    async openSections(requests) {
      // 卡片间可并发；同一卡片内的条目共用 moduleInfo，必须依次展开。
      return Promise.all((requests || []).map(async request => {
        const card = cards().find(c => c.info.modName === request.group);
        if (!card) return { group: request.group, ok: false, error: '板块已不在页面上' };
        const { vm } = card;
        try {
          if (card.info.modType !== 2) {
            if (!vm.isEdit?.[0] && !vm.isEdit) await vm.handleTopClick();
            else if (Array.isArray(vm.isEdit) && !vm.isEdit[0]) await vm.handleClick(0);
          } else {
            for (const row of request.rows || []) if (!vm.isEdit?.[row]) await vm.handleClick(row);
            if (request.add && !vm.isAdd) await vm.handleTopClick();
          }
          await vm.$nextTick();
          return { group: request.group, ok: true };
        } catch (_) { return { group: request.group, ok: false, error: '网站未能展开编辑器，请检查页面提示' }; }
      }));
    },
    list: () => all().map(x => x.d),
    // 两级字典摊平：省的 id 加 “p:” 前缀（直辖市的省和市共用一个 value，不加前缀会撞）
    tree(key) {
      const x = byKey().get(key); const out = [];
      for (const p of x?.f.items || []) {
        out.push({ id: 'p:' + p.value, name: p.name, parent: null });
        for (const c of p.items || []) out.push({ id: String(c.value), name: c.name, parent: 'p:' + p.value });
      }
      return out;
    },
    async writeMany(items) {
      const map = byKey(), out = [];
      for (const { key, raw } of items) {
        const x = map.get(key);
        if (!x) { out.push({ key, ok: false, error: '字段已不在页面上（编辑卡片关了？）' }); continue; }
        // 可搜索的大字典（学校、专业，editStyle 18）：显示的文字在控件自己身上，只改 formData 网页上看着是空的。
        // 调控件自己的 handleSelect（和在下拉里点一项完全一样），它会通知编辑器写值、并把文字显示出来。
        const ac = +x.f.editStyle === 18 && raw ? autocompleteOf(x) : null, it = ac && (x.f.items || []).find(i => String(i.value) === String(raw));
        if (+x.f.editStyle === 18 && raw && (!ac || !it)) { out.push({ key, ok: false, error: '搜索控件未找到对应字典项' }); continue; }
        if (ac && it) ac.handleSelect({ ...it });
        else if (+x.f.editStyle === 11) {
          const control = twoLayersOf(x);
          if (!control) { out.push({ key, ok: false, error: '没有找到两级选择控件' }); continue; }
          // TwoLayers 的 code 是初始数据的单向 prop。它自己的 checkedValues 控制显示，
          // 只改编辑器 formData 会造成“回读有值、输入框空白”。沿用控件正常选择后的事件。
          control.initCheckedVal(raw == null ? '' : String(raw));
          const selects = control.checkedSelects || [];
          if (raw && !selects.length) { out.push({ key, ok: false, error: '两级选择控件未接受字典值' }); continue; }
          control.$emit('onChange', { code: raw, selects, value: selects.map(s => s.value).join(','), isChecked: !!raw });
        }
        else x.E.$set(x.E.formData, x.f.colName, raw);
        out.push({ key, ok: true });
      }
      await new Promise(r => setTimeout(r, 50));
      return out;
    },
    addRow() { return false; },
    // 附件：Element Upload 的隐藏 input，在同名的表单项里
    upload(key, file) {
      const x = byKey().get(key);
      const item = x && [...x.E.$el.querySelectorAll('.el-form-item')].find(i => (i.querySelector('.el-form-item__label')?.innerText || '').includes(x.f.cname));
      const input = item?.querySelector('input[type=file]');
      if (!input) throw Error('没找到上传框');
      const bin = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.mime }));
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    focus(key) {
      const x = byKey().get(key); const el = x?.E.$el?.querySelectorAll('.el-form-item')?.[fieldsOf(x.E).indexOf(x.f)] || x?.E.$el;
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = el.style.boxShadow; el.style.boxShadow = '0 0 0 3px rgba(37,99,235,.6)'; setTimeout(() => { el.style.boxShadow = prev; }, 1600);
      return true;
    },
    mark(keys) {
      for (const el of document.querySelectorAll('[data-af-mark]')) { el.style.outline = el.dataset.afMark === '-' ? '' : el.dataset.afMark; el.removeAttribute('data-af-mark'); }
      const want = new Set(keys || []);
      for (const x of all()) {
        if (!want.has(x.d.key)) continue;
        const el = [...x.E.$el.querySelectorAll('.el-form-item')].find(i => (i.querySelector('.el-form-item__label')?.innerText || '').includes(x.f.cname));
        if (!el) continue;
        el.dataset.afMark = el.style.outline || '-'; el.style.outline = '2px dashed #f59e0b';
      }
      return true;
    },
  });
})();
