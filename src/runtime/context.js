// Shared by the service worker and isolated content world; no DOM/storage access.
(() => {
  const AF = (globalThis.AF ||= {});
  const sections = [[/教育|学历|学习经历/, 'education'], [/实习/, 'internship'], [/工作|职业|任职/, 'work'], [/项目|科研/, 'project'], [/家庭|亲属|紧急/, 'family'], [/校园|社团|社会实践/, 'campus'], [/证书|技能|语言/, 'skills'], [/个人|基本|基础|联系|身份/, 'basic']];
  const hostOf = s => String(s || '').toLowerCase().replace(/^https?:\/\//, '').split(/[/:?#]/)[0];
  function page(page = {}) {
    let { host = '', path = '/', search = '' } = page;
    try { if (page.url) { const u = new URL(page.url); host ||= u.hostname; path = u.pathname; search ||= u.search; } } catch (_) {}
    host = hostOf(host);
    let tenant = '';
    if (/(^|\.)51job\.com$/.test(host)) { const id = [...new URLSearchParams(search).entries()].find(([k]) => k.toLowerCase() === 'ctmid')?.[1]; tenant = id ? 'ctmid=' + id : ''; }
    else if (/(^|\.)mokahr\.com$/.test(host)) tenant = path.match(/\/(?:campus|social|intern|official|apply)(?:_apply)?\/([^/?#]+)/i)?.[1] || '';
    else tenant = path.match(/\/(SU[^/]+)/i)?.[1] || '';
    return { host, path, siteScope: host + (tenant ? ':' + tenant.toLowerCase() : '') };
  }
  function field(f = {}, p = {}, platform = f.platform || p.platform || 'generic') {
    const site = page(p.host || p.url ? p : { ...p, host: f.host || '', path: p.path || f.path || '/' });
    const section = String(f.section || f.groupTitle || '');
    const pageType = f.pageType || p.pageType || sections.find(([re]) => re.test(section))?.[1] || `form:${site.path.replace(/\b\d+\b/g, ':id')}`;
    return { ...f, platform, host: site.host, scope: f.scope || site.siteScope, siteScope: f.siteScope || f.scope || site.siteScope, pageType };
  }
  const key = f => JSON.stringify([f.platform || 'generic', f.siteScope || f.scope || '', f.pageType || 'unknown']);
  function matches(record, f) {
    if ((record.platform || 'generic') !== (f.platform || 'generic')) return false;
    if (record.scopeVersion === 2) {
      if (record.pageType !== f.pageType) return false;
      return record.scopeLevel === 'platform' ? record.confirmedShared === true : !!f.siteScope && record.siteScope === f.siteScope;
    }
    // Old records remain in storage. Only reuse when their origin is unambiguous.
    if (!f.host || hostOf(record.host) !== f.host) return false;
    const priorScope = record.scope || hostOf(record.host);
    const legacyPage = record.pageType || sections.find(([re]) => re.test(record.section || ''))?.[1];
    return priorScope === f.siteScope && !!legacyPage && legacyPage === f.pageType;
  }
  AF.context = { page, field, key, matches };
})();
