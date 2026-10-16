// 页面侧运行时（world: MAIN）：只有这里读得到 React/Vue 组件内部（插件的隔离环境看不到 __reactInternalInstance）。
// 边界：页面侧只做“认平台 / 列出字段原始数据 / 写原始值 / 定位”，不做任何“资料对应什么”的判断——
// 那些在 core/ 里，是纯函数，有单测。页面侧一旦夹带业务逻辑，就又回到不可测的老路。
(() => {
  if (window.__afPage) return;
  const adapters = [];
  Object.defineProperty(window, '__afPage', { value: { register: a => { if (!a.id || typeof a.detect !== 'function' || typeof a.list !== 'function') throw Error('无效页面适配器'); if (adapters.some(x => x.id === a.id)) throw Error('重复页面适配器'); adapters.push(a); } } });

  const reply = (id, data) => document.dispatchEvent(new CustomEvent('af:page-reply', { detail: JSON.stringify({ id, ...data }) }));
  const detect = () => [...adapters].sort((a, b) => ((globalThis.AF_MODULES || []).find(m => m.id === b.id)?.priority || 0) - ((globalThis.AF_MODULES || []).find(m => m.id === a.id)?.priority || 0)).find(a => { try { return a.detect(); } catch (_) { return false; } }) || null;

  document.addEventListener('af:page', async e => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch (_) { return; }
    const { id, op, args = [] } = msg || {};
    if (!id || !op) return;
    try {
      const a = detect();
      if (op === 'detect') return reply(id, { result: a ? a.id : null });
      if (op === 'fetchText') return reply(id, { result: await (await fetch(args[0], { credentials: 'omit' })).text() });
      if (!a) return reply(id, { error: '页面上没有认出的招聘系统' });
      if (typeof a[op] !== 'function') return reply(id, { error: `平台不支持 ${op}` });
      reply(id, { result: await a[op](...args) });
    } catch (err) {
      reply(id, { error: String(err?.message || err) });
    }
  });
})();
