// 诊断记录只保存字段元数据和经过脱敏的原因，不保存资料值。
(() => {
  if (globalThis.AF?.diag) return;
  const AF = (globalThis.AF ||= {});

  const text = value => String(value ?? '').slice(0, 500);
  function sanitizePath(path) {
    let value = text(path).split(/[?#]/, 1)[0] || '/';
    value = value.replace(/\/+/g, '/');
    return value.split('/').map(segment => {
      if (/^(?:\d{3,}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}|[a-f\d]{24,})$/i.test(segment)) return ':id';
      if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(segment)) return ':id';
      return segment.slice(0, 80);
    }).join('/') || '/';
  }
  function sanitizeHost(host) {
    try { return new URL(`https://${text(host).replace(/^https?:\/\//i, '').split(/[/?#]/)[0]}`).hostname.toLowerCase().slice(0, 253); }
    catch (_) { return ''; }
  }
  function sanitizeReason(reason) {
    return text(reason)
      .replace(/https?:\/\/[^\s"'“”‘’]+/gi, '[网址]')
      .replace(/[“”‘’「」『』"'][^“”‘’「」『』"']{0,200}[“”‘’「」『』"']/g, '[资料值]')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[隐私值]')
      .replace(/(?:\+?\d[\d\s()-]{7,}\d)/g, '[隐私值]')
      .replace(/你的意向城市[：:]\s*[^；;\n。]*/g, '你的意向城市：[资料城市]')
      .replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\\/\s"'“”‘’]+[\\/])*[^\\/\s"'“”‘’]*\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|zip|txt|csv)\b/gi, '[文件名]')
      .replace(/\b[\p{L}\p{N}_(). -]{1,120}\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|zip|txt|csv)\b/giu, '[文件名]')
      .slice(0, 300);
  }
  function sanitizeItem(item = {}) {
    const page = item.page || {};
    return {
      platform: text(item.platform), key: text(item.key), id: text(item.id), type: text(item.type), kind: text(item.kind),
      label: text(item.label), section: text(item.section), row: Number.isFinite(item.row) ? item.row : null,
      stage: text(item.stage), reason: sanitizeReason(item.reason), optionsCount: Number.isFinite(item.optionsCount) ? item.optionsCount : 0,
      page: {
        host: sanitizeHost(page.host || item.host || ''), path: sanitizePath(page.path || '/'),
        react: page.react === true, vue: page.vue === true,
        classPrefixes: Array.isArray(page.classPrefixes) ? page.classPrefixes.filter(x => typeof x === 'string').slice(0, 15).map(x => x.slice(0, 40)) : [],
      },
      at: text(item.at || new Date().toISOString()),
    };
  }
  function aggregate(items = []) {
    const groups = new Map();
    for (const raw of Array.isArray(items) ? items : []) {
      const item = sanitizeItem(raw);
      const key = `${item.page.host}${item.page.path}`;
      let group = groups.get(key);
      if (!group) groups.set(key, group = { host: item.page.host, path: item.page.path, lastAt: item.at, failCount: 0, unmappedCount: 0, aiCount: 0, otherCount: 0, fields: [] });
      if (item.at > group.lastAt) group.lastAt = item.at;
      if (/^(?:unmapped|nodata|unknown)$/i.test(item.stage)) group.unmappedCount++;
      else if (/^ai$/i.test(item.stage)) group.aiCount++;
      else if (/^(?:encode|verify|error|dom|upload)$/i.test(item.stage)) group.failCount++;
      else group.otherCount++;
      group.fields.push({ platform: item.platform, label: item.label || item.key || item.id, section: item.section, row: item.row, type: item.type, kind: item.kind, stage: item.stage, reason: item.reason, at: item.at });
    }
    return [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  function pageSignature() {
    const prefix = new Map();
    for (const el of document.querySelectorAll('[class]')) {
      if (prefix.size > 400) break;
      for (const c of el.classList) { const p = c.split(/[-_]/)[0]; if (p.length > 1) prefix.set(p, (prefix.get(p) || 0) + 1); }
    }
    const any = document.querySelector('input,div');
    const keys = any ? Object.keys(any).filter(k => k.startsWith('__')).map(k => k.replace(/\$.*/, '')) : [];
    return { host: location.hostname, path: location.pathname.slice(0, 80), react: keys.some(k => /react/i.test(k)), vue: !!document.querySelector('[data-v-app]') || keys.some(k => /vue/i.test(k)), classPrefixes: [...prefix].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p]) => p) };
  }
  function record(items, extra = {}) {
    if (!items?.length) return;
    const page = pageSignature();
    const at = new Date().toISOString();
    try { chrome.runtime.sendMessage({ type: 'DIAG', items: items.map(x => sanitizeItem({ ...x, ...extra, page, at })) }, () => void chrome.runtime.lastError); } catch (_) {}
  }
  AF.diag = { record, pageSignature, sanitizePath, sanitizeReason, sanitizeItem, aggregate };
})();
