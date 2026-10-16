// 插件隔离环境 ⇄ 页面侧（runtime/page-runtime.js）的调用。两边只交换 JSON 字符串。
(() => {
  if (globalThis.AF?.rpc) return;
  const AF = (globalThis.AF ||= {});
  // 旧版 Chrome/Edge（< 111）不支持 world: MAIN 的内容脚本，页面侧不会自动加载：第一次没响应时用 <script> 注入一次。
  // （网站 CSP 禁止外部脚本时注入也会失败，此时自动退回模拟点击引擎。）
  let injected = false;
  function inject() {
    if (injected || !globalThis.chrome?.runtime?.getURL) return false;
    injected = true;
    for (const f of globalThis.AF_PAGE_SCRIPTS) {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL(f); s.async = false;
      (document.head || document.documentElement).append(s);
    }
    return true;
  }
  const call = (op, args, wait) => new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const done = () => { document.removeEventListener('af:page-reply', on); clearTimeout(timer); };
    const on = e => {
      let m; try { m = JSON.parse(e.detail); } catch (_) { return; }
      if (m?.id !== id) return;
      done();
      m.error ? reject(Error(m.error)) : resolve(m.result);
    };
    // 页面侧没加载（旧浏览器不支持 world: MAIN、或页面在注入前就报错）时不能一直等。
    const timer = setTimeout(() => { done(); reject(Error('页面侧没有响应')); }, wait);
    document.addEventListener('af:page-reply', on);
    document.dispatchEvent(new CustomEvent('af:page', { detail: JSON.stringify({ id, op, args }) }));
  });
  // 认平台用短超时：没认出就走兜底引擎，不能让用户等 6 秒
  AF.rpc = async (op, ...args) => {
    const wait = op === 'openSections' ? 45000 : op === 'fetchText' ? 15000 : op === 'detect' ? 800 : 6000;
    try { return await call(op, args, wait); }
    catch (e) {
      if (e.message !== '页面侧没有响应' || !inject()) throw e;
      await new Promise(r => setTimeout(r, 300));
      return call(op, args, wait);
    }
  };
})();
