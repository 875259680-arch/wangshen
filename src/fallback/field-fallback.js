// A narrow fallback for unresolved platform fields. Never calls domEngine.run().
(() => {
  const AF = globalThis.AF;
  async function run({ fields, results, adapter, facts, cancelled = () => false }) {
    const visited = new Set();
    for (const result of results.filter(r => ['nodata', 'fail'].includes(r.state))) {
      if (cancelled()) break;
      const field = fields.find(f => f.key === result.key);
      if (!field || field.disabled || adapter.kind(field) === 'file' || adapter.kind(field) === 'consent') continue;
      const target = adapter.mapField(field);
      if (!target || target.sem === 'declareNo' || target.sem === 'none') continue;
      const value = adapter.resolveValue(target, facts, field.row);
      if (value == null || value === '' || typeof value === 'object') continue;
      const candidates = AF.scan.scan().filter(f => field.domKey ? f.key === field.domKey :
        field.section && f.section && AF.text.norm(f.label) === AF.text.norm(field.label) &&
        AF.text.norm(f.section) === AF.text.norm(field.section) && (f.row || 0) === (field.row || 0));
      if (candidates.length !== 1) {
        result.failureCode = candidates.length > 1 ? 'AMBIGUOUS_MATCH' : 'CONTROL_UNSUPPORTED';
        result.reason ||= candidates.length > 1 ? '通用控件定位存在多个候选，待确认' : '无法唯一定位通用控件，待适配';
        continue;
      }
      const f = candidates[0];
      // Existing values, successful fields and repeated candidates are never overwritten.
      if (f.value || visited.has(f.key) || f.kind === 'file') continue;
      visited.add(f.key);
      try {
        const refind = () => AF.scan.scan().find(x => x.key === f.key);
        const outcome = await AF.controls.fill(f, value, { refind, pick: async () => -1 });
        const fresh = refind();
        const ok = outcome.ok && fresh && AF.controls.matches(fresh, fresh.value, value);
        Object.assign(result, { state: ok ? 'ok' : 'fail', source: '通用字段兜底', value: ok ? fresh.value : undefined,
          reason: ok ? '' : '通用填写后未通过读回校验', failureCode: ok ? null : 'VALIDATION_FAILED' });
      } catch (_) { Object.assign(result, { state: 'fail', reason: '通用控件操作失败', failureCode: 'CONTROL_FAILED' }); }
    }
    return results;
  }
  AF.fieldFallback = { run };
})();
