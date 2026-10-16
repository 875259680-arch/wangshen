// Replace __ID__ through tools/new-adapter.mjs. Keep profile data out of page.js.
(() => {
  const AF = globalThis.AF;
  const section = f => f.section || f.groupTitle || '';
  AF.platforms ||= {};
  AF.platforms.__ID__ = {
    name: '__ID__', section,
    kind: f => f.type || 'unknown',
    listOf: () => null, // TODO: map actual repeated sections before enabling.
    addArg: f => f.group,
    target: f => AF.mapping.byLabel(f.label, null),
    options: f => f.options || [],
    encode: () => ({ error: '新模块尚未实现格式转换' }),
    decode: (_, raw) => raw == null ? '' : String(raw),
    same: (_, actual, expected) => JSON.stringify(actual) === JSON.stringify(expected),
  };
})();
