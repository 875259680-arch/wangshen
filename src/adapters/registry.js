// Isolated-world module registry. Existing pure mapping functions remain compatible.
(() => {
  const AF = (globalThis.AF ||= {}), overrides = [];
  const required = ['kind', 'target', 'options', 'encode', 'decode', 'same', 'section', 'addArg', 'listOf'];
  function metadata(id) { return (globalThis.AF_MODULES || []).find(m => m.id === id); }
  function registerOverride(rule) {
    if (!rule.id || !rule.platform || typeof rule.match !== 'function' || !rule.methods) throw Error('无效的网站覆盖模块');
    if (overrides.some(r => r.id === rule.id)) throw Error(`重复模块 ${rule.id}`);
    overrides.push(Object.freeze({ priority: 0, ...rule }));
  }
  function resolve(id, page) {
    const base = AF.platforms?.[id]; if (!base) return null;
    for (const name of required) if (typeof base[name] !== 'function') throw Error(`${id} 缺少接口 ${name}`);
    const ctx = { ...AF.context.page(page), platform: id, path: page.path || '/', pageType: page.pageType || null };
    const layers = overrides.filter(r => r.platform === id && r.match(ctx)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const adapter = { ...base, ...Object.assign({}, ...layers.filter(r => !r.pageTypes).map(r => r.methods)) };
    // Page types can coexist on one long form; apply field overrides separately.
    for (const name of ['kind', 'target', 'options', 'encode', 'decode', 'same', 'listOf', 'companion']) {
      if (!layers.some(r => typeof r.methods[name] === 'function')) continue;
      adapter[name] = (f, ...args) => {
        const type = AF.context.field({ ...f, section: f.section || base.section(f) }, page, id).pageType;
        const hit = [...layers].reverse().find(r => typeof r.methods[name] === 'function' && (!r.pageTypes || r.pageTypes.includes(type)));
        return (hit?.methods[name] || base[name])?.(f, ...args);
      };
    }
    const meta = metadata(id) || { id, version: 'legacy' };
    return Object.assign(adapter, {
      moduleId: layers[layers.length - 1]?.id || id, moduleVersion: layers[layers.length - 1]?.version || meta.version,
      parse: adapter.parse || (() => AF.rpc('list')),
      mapField: f => adapter.target(f) || AF.mapping.bySection(f.label, adapter.section(f)),
      resolveValue: (target, facts, row) => AF.mapping.valueOf(target, facts, row),
      convertValue: (f, value, ctx) => adapter.encode(f, value, ctx),
      execute: adapter.execute || (batch => AF.rpc('writeMany', batch)),
      verify: adapter.verify || ((f, expected) => adapter.same(f, f.raw, expected) && !f.validationError),
      learning: () => AF.memory,
      diagnostics: items => AF.diag.record(items, { platform: id, moduleId: layers[layers.length - 1]?.id || id, moduleVersion: meta.version }),
    });
  }
  AF.adapters = { resolve, registerOverride, metadata,
    knownHost: host => (globalThis.AF_MODULES || []).some(m => m.hosts.some(h => host === h || host.endsWith('.' + h))),
    list: () => (globalThis.AF_MODULES || []).map(m => ({ ...m })),
  };
})();
