// 旧版 Chrome/Edge（< 99）的 tabs/runtime 消息接口不返回 Promise：统一包成回调形式。
const tabSend = (tabId, msg, opts = {}) => new Promise((ok, bad) => chrome.tabs.sendMessage(tabId, msg, opts, r => { const e = chrome.runtime.lastError; e ? bad(e) : ok(r); }));
const activeTab = () => new Promise(ok => chrome.tabs.query({ active: true, currentWindow: true }, tabs => ok(tabs?.[0])));
const tab = activeTab;
document.getElementById('fill').onclick = async () => {
  const t = await tab();
  tabSend(t.id, { type: 'RUN', fromCommand: true, opts: {} }).catch(() => alert('请刷新页面后再试'));
  window.close();
};
document.getElementById('show').onclick = async () => {
  const t = await tab();
  tabSend(t.id, { type: 'SHOW' }, { frameId: 0 }).catch(() => alert('请刷新页面后再试'));
  window.close();
};
document.getElementById('options').onclick = () => chrome.runtime.openOptionsPage();
