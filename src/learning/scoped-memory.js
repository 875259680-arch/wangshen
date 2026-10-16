// Scope enforcement around the legacy matching algorithm. Storage keys stay unchanged.
(() => {
  const AF = globalThis.AF, legacy = AF.memory;
  const decorate = (f, host, platform) => AF.context.field(f, { host: host || f.host, path: f.path || '/' }, platform);
  const scopeRecord = (m, f) => ({ ...m, legacyId: m.id, id: `v2:${AF.context.key(f)}:${m.id}`, scopeVersion: 2,
    scopeLevel: 'site', platform: f.platform, host: f.host, scope: f.siteScope, siteScope: f.siteScope, pageType: f.pageType });
  const eligible = (memories, f) => Object.fromEntries(Object.values(memories || {}).filter(m => AF.context.matches(m, f)).sort((a, b) => (a.scopeLevel === 'platform') - (b.scopeLevel === 'platform') || (b.scopeVersion || 0) - (a.scopeVersion || 0) || (b.updatedAt || 0) - (a.updatedAt || 0)).map(m => {
    const item = { ...m, id: m.legacyId || m.id }; return [m.id, item];
  }));
  AF.memory = { ...legacy,
    lookup: (memories, platform, f, value) => legacy.lookup(eligible(memories, decorate(f, f.host, platform)), platform, f, value),
    lookupMap: (memories, platform, f) => legacy.lookupMap(eligible(memories, decorate(f, f.host, platform)), platform, f),
    make(item, host) { const f = decorate(item, host, item.platform); return scopeRecord(legacy.make(f, host), f); },
    makeMap(item, platform, map, by, host) { const f = decorate(item, host, platform); return scopeRecord(legacy.makeMap(f, platform, map, by, host), f); },
    // Explicitly called by a future management UI/developer; never automatic promotion.
    promote(record) {
      if (record.scopeVersion !== 2 || !record.map || record.map === 'none' || legacy.needsScope(record.label)) throw Error('仅明确的资料映射可提升为类型共享规则');
      const shared = { ...record, scopeLevel: 'platform', confirmedShared: true, siteScope: '', scope: null };
      return { ...shared, id: `v2:shared:${record.platform}:${record.pageType}:${record.legacyId}` };
    },
    bind(record, context) {
      const f = decorate({ ...record, ...context, scope: context.siteScope, siteScope: context.siteScope }, context.host, context.platform);
      if (!f.host || !context.pageType || !context.platform) throw Error('重新绑定需要网站、平台和页面类型');
      const ident = String(record.ident).split('@scope:')[0] + (legacy.needsScope(record.label) ? '@scope:' + f.siteScope : '');
      const item = { ...record, ident, platform: f.platform };
      item.id = legacy.idOf(item);
      return scopeRecord(item, f);
    },
    status(record) { return record.scopeVersion === 2 ? record.scopeLevel : record.host ? 'legacy-origin-only' : 'needs-confirmation'; },
  };
})();
