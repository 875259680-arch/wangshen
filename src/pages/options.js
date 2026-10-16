const $ = id => document.getElementById(id);
const get = keys => chrome.storage.local.get(keys);
const set = obj => chrome.storage.local.set(obj);
const say = (id, msg, ok = true) => { $(id).textContent = msg; $(id).className = ok ? 'ok' : 'err'; };

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('section').forEach(s => { s.hidden = s.id !== b.dataset.tab; });
});

// ---------- 资料 ----------
async function loadProfile() {
  const { profile = {} } = await get('profile');
  $('profileText').value = JSON.stringify(profile, null, 2);
}
$('saveProfile').onclick = async () => {
  try {
    const profile = JSON.parse($('profileText').value);
    await set({ profile, profileRev: Date.now() });
    say('profileMsg', '已保存');
  } catch (e) { say('profileMsg', 'JSON 格式有误：' + e.message, false); }
};

// ---------- 意向城市优先级 ----------
async function loadCities() {
  const { profile = {} } = await get('profile');
  const c = profile.jobPreferences?.cities;
  $('cityPrefs').value = (Array.isArray(c) ? c : String(c || '').split(/[、,，\s/]+/).filter(Boolean)).join('、');
}
$('saveCities').onclick = async () => {
  const { profile = {} } = await get('profile');
  (profile.jobPreferences ||= {}).cities = $('cityPrefs').value.split(/[、,，\s/]+/).map(x => x.trim()).filter(Boolean);
  await set({ profile });
  say('cityMsg', `已保存：${profile.jobPreferences.cities.join(' > ') || '（空）'}`);
  loadProfile();
};
loadCities();

// ---------- 记住的回答 ----------
async function loadAnswers() {
  const { answers = {} } = await get('answers');
  const q = $('answerFilter').value.trim();
  const rows = Object.entries(answers)
    .filter(([, a]) => !q || (a.label + a.value + (a.section || '')).includes(q))
    .sort((x, y) => (y[1].updatedAt || 0) - (x[1].updatedAt || 0));
  $('answerRows').replaceChildren(...rows.map(([k, a]) => {
    const tr = document.createElement('tr');
    const td = (v) => { const c = document.createElement('td'); c.textContent = v; return c; };
    const input = document.createElement('input');
    input.value = a.value;
    input.onchange = async () => {
      const { answers: all = {} } = await get('answers');
      all[k] = { ...all[k], value: input.value, updatedAt: Date.now() };
      await set({ answers: all });
      say('answerMsg', '已更新');
    };
    const del = document.createElement('button');
    del.textContent = '删除';
    del.onclick = async () => {
      const { answers: all = {} } = await get('answers');
      delete all[k];
      await set({ answers: all });
      loadAnswers();
    };
    const vc = document.createElement('td'); vc.append(input);
    const dc = document.createElement('td'); dc.append(del);
    tr.append(td(a.section || ''), td(a.label), td(String((a.row || 0) + 1)), vc, dc);
    return tr;
  }));
  if (!rows.length) say('answerMsg', '还没有记住的回答。在网页上手动填完后，点面板里的“记住”。');
}
$('answerFilter').oninput = () => { loadAnswers(); loadMemories(); };

// ---------- 学到的规则 ----------
const PLATFORM = { moka: 'Moka', beisen: '北森', hotjob: 'Hotjob', feishu: '飞书招聘', job51: '前程无忧', job51v: '前程无忧' };
async function loadMemories() {
  const { memories = {} } = await get('memories');
  const q = $('answerFilter').value.trim();
  const rows = Object.values(memories).filter(m => !q || (m.label + m.to + (m.from || '')).includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
  $('memRows').replaceChildren(...rows.map(m => {
    const tr = document.createElement('tr');
    const td = v => { const c = document.createElement('td'); c.textContent = v; return c; };
    const del = document.createElement('button');
    del.textContent = '删除';
    del.onclick = async () => { await chrome.runtime.sendMessage({ type: 'MEM_DELETE', id: m.id }); loadMemories(); };
    const dc = document.createElement('td'); dc.append(del);
    const NAMES = { edu: '教育', intern: '实习', work: '工作', workOrIntern: '工作/实习', project: '项目', campus: '校园', cert: '证书', family: '家庭' };
    const rule = m.map ? (m.map === 'none' ? `${m.by === 'AI' ? 'AI 判断：' : ''}资料里没有，留给你填` : `${m.by === 'AI' ? 'AI 判断：' : ''}对应资料“${m.map.split('.').map(x => NAMES[x] || x).join(' · ')}”`)
      : m.from != null ? `资料是“${m.from}”时 → 填“${m.to}”` : `固定填“${m.to}”`;
    const label = m.label + (m.section ? `（${m.section}${m.row ? ` 第 ${m.row + 1} 条` : ''}）` : '');
    tr.append(td(`${PLATFORM[m.platform] || m.platform || '其它网站'} · ${m.scopeVersion === 2 ? (m.scopeLevel === 'platform' ? '类型共享' : m.siteScope) + ' / ' + m.pageType : '旧记录：按来源兼容，范围不明需重新学习'}`), td(label), td(rule), td((m.history || []).map(h => h.to).join('、')), dc);
    return tr;
  }));
  // 资料补充（资料里空着、你在网页上补答过的项，所有网站通用）排在最前
  const { supplement = {} } = await get('supplement');
  const sup = Object.entries(supplement).filter(([, v]) => !q || (v.label + v.value).includes(q)).map(([k, v]) => {
    const tr = document.createElement('tr');
    const td = x => { const c = document.createElement('td'); c.textContent = x; return c; };
    const del = document.createElement('button'); del.textContent = '删除';
    del.onclick = async () => { await chrome.runtime.sendMessage({ type: 'SUPPLEMENT_DELETE', key: k }); loadMemories(); };
    const dc = document.createElement('td'); dc.append(del);
    tr.append(td('所有网站'), td(v.label || k), td(`资料补充：填“${v.value}”（资料里这项填了以后以资料为准）`), td(''), dc);
    return tr;
  });
  $('memRows').prepend(...sup);
  say('memMsg', rows.length + sup.length ? `共 ${rows.length + sup.length} 条` : '还没有。网页上手动改完后，在面板里逐条点“记住”。');
}
loadMemories();
$('clearCache').onclick = async () => { await set({ cache: {} }); say('answerMsg', 'AI 缓存已清空'); };

// ---------- 材料 ----------
// 每种材料一个文件，存在 files[种类]。旧版单独存的简历（resume）、证件照（photo）照常显示和使用。
const readB64 = file => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
async function loadFiles() {
  const { files = {}, resume, photo } = await get(['files', 'resume', 'photo']);
  const legacy = { 简历: resume, 证件照: photo };
  $('fileRows').replaceChildren(...AF.files.KINDS.map(kind => {
    const cur = files[kind] || legacy[kind];
    const tr = document.createElement('tr');
    const name = document.createElement('td'); name.textContent = kind;
    const now = document.createElement('td'); now.textContent = cur?.name ? `${cur.name}${cur.size ? `（${Math.round(cur.size / 1024)} KB）` : ''}` : '—';
    const act = document.createElement('td');
    const pick = document.createElement('input'); pick.type = 'file'; pick.hidden = true;
    const choose = document.createElement('button'); choose.textContent = cur ? '更换' : '选择文件'; choose.onclick = () => pick.click();
    pick.onchange = async () => {
      const f = pick.files[0]; if (!f) return;
      const { files: all = {} } = await get('files');
      all[kind] = { kind, name: f.name, mime: f.type || 'application/octet-stream', size: f.size, base64: await readB64(f), updatedAt: Date.now() };
      await set({ files: all });
      say('fileMsg', `已保存：${kind}`); loadFiles();
    };
    act.append(choose, pick);
    if (files[kind]) {
      const del = document.createElement('button'); del.textContent = '删除'; del.style.marginLeft = '6px';
      del.onclick = async () => { const { files: all = {} } = await get('files'); delete all[kind]; await set({ files: all }); loadFiles(); };
      act.append(del);
    }
    tr.append(name, now, act);
    return tr;
  }));
}
loadFiles();

// ---------- 网站诊断 ----------
async function loadDiagnostics() {
  const { diag = [] } = await get('diag');
  const groups = AF.diag.aggregate(diag);
  const root = $('diagRows');
  root.replaceChildren();
  for (const group of groups) {
    const card = document.createElement('article'); card.className = 'diag-card';
    const title = document.createElement('h3'); title.textContent = `${group.host || '未知网站'}${group.path}`;
    const summary = document.createElement('p'); summary.textContent = `最后记录：${group.lastAt}　失败：${group.failCount}　未匹配：${group.unmappedCount}　AI 回答：${group.aiCount}　其他：${group.otherCount}`;
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const label of ['板块', '字段', '阶段', '原因', '时间']) { const th = document.createElement('th'); th.textContent = label; hr.append(th); }
    head.append(hr); const body = document.createElement('tbody');
    for (const field of group.fields) {
      const tr = document.createElement('tr');
      const values = [field.section, `${field.label}${field.row == null ? '' : `（第 ${field.row + 1} 条）`}`, field.stage, field.reason, field.at];
      for (const value of values) { const td = document.createElement('td'); td.textContent = value || '—'; tr.append(td); }
      body.append(tr);
    }
    table.append(head, body); card.append(title, summary, table); root.append(card);
  }
  if (!groups.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '还没有网站诊断记录。'; root.append(empty); }
  say('diagMsg', `共 ${diag.length} 条记录，${groups.length} 个页面`);
}
$('refreshDiag').onclick = loadDiagnostics;
$('exportDiag').onclick = async () => {
  const { diag = [] } = await get('diag');
  const data = { ...AF.diag.bundle(diag, chrome.runtime.getManifest().version), groups: AF.diag.aggregate(diag) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'wangshen-diagnostics.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('diagMsg', `已导出 ${diag.length} 条脱敏诊断`);
};
loadDiagnostics();

// ---------- 填写策略 ----------
$('stratList').replaceChildren(...AF.strategy.map(s => {
  const box = document.createElement('div'); box.className = 'strat';
  const h = document.createElement('h3'); h.textContent = s.field;
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th style="width:42%">情况</th><th>怎么填</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const [when, how] of s.cases) { const tr = document.createElement('tr'); for (const v of [when, how]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); } tb.append(tr); }
  t.append(tb); box.append(h, t);
  return box;
}));

// ---------- AI ----------
async function loadAi() {
  const { settings = {} } = await get('settings');
  $('baseUrl').value = settings.baseUrl || 'https://api.deepseek.com';
  $('model').value = settings.model || 'deepseek-flash';
  $('apiKey').value = settings.apiKey || '';
  $('autoExpand').checked = settings.autoExpand !== false;
}
const formSettings = () => ({ baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim(), apiKey: $('apiKey').value.trim(), autoExpand: $('autoExpand').checked });
$('saveAi').onclick = async () => {
  const s = formSettings();
  if (!/^https:\/\/api\.deepseek\.com/.test(s.baseUrl)) {
    const origin = new URL(s.baseUrl).origin + '/*';
    const granted = await new Promise(ok => chrome.permissions.request({ origins: [origin] }, g => { void chrome.runtime.lastError; ok(!!g); }));
    if (!granted) return say('aiMsg', '没有获得访问该接口的权限', false);
  }
  const { settings = {} } = await get('settings');
  await set({ settings: { ...settings, ...s } });
  say('aiMsg', '已保存');
};
$('testAi').onclick = async () => {
  say('aiMsg', '测试中…');
  const r = await new Promise(ok => chrome.runtime.sendMessage({ type: 'TEST_AI', settings: formSettings() }, x => ok(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : x)));
  r?.error ? say('aiMsg', r.error, false) : say('aiMsg', `连接正常，用时 ${r.ms} 毫秒`);
};

// ---------- 备份与迁移 ----------
const BACKUP_KEYS = AF.backup.dataKeys;
const backupOptions = () => ({
  extensionVersion: chrome.runtime.getManifest().version,
  includeApiKey: $('withKey').checked,
});
const refreshRestoredData = () => Promise.all([
  loadProfile(), loadCities(), loadAnswers(), loadMemories(), loadFiles(), loadAi(),
]);
async function updateUndoButton() {
  const { migrationPrevious } = await get('migrationPrevious');
  $('undoImport').hidden = !migrationPrevious;
}
async function exportBackup() {
  const data = await get(BACKUP_KEYS);
  const backup = AF.backup.build(data, backupOptions());
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `wangshen-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('exportMsg', `已导出：记住的回答 ${Object.keys(backup.data.answers).length} 条，学习规则 ${Object.keys(backup.data.memories).length} 条，附件 ${Object.keys(backup.data.files).length} 个${$('withKey').checked ? '，含 API Key' : '，不含 API Key'}`);
}
$('exportBtn').onclick = async () => {
  try { await exportBackup(); }
  catch (err) { say('exportMsg', '导出失败：' + err.message, false); }
};
$('importFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const payload = AF.backup.prepareImport(await file.text());
    if (!confirm('导入会完整替换本机的资料、回答、学习规则、附件、设置和缓存。导入前会保存当前数据，可撤销。继续吗？')) return;
    const current = AF.backup.build(await get(BACKUP_KEYS), { extensionVersion: chrome.runtime.getManifest().version });
    await set({ migrationPrevious: current, ...payload });
    await refreshRestoredData();
    await updateUndoButton();
    say('importMsg', `已完整恢复：记住的回答 ${Object.keys(payload.answers).length} 条，学习规则 ${Object.keys(payload.memories).length} 条，附件 ${Object.keys(payload.files).length} 个`);
  } catch (err) { say('importMsg', '导入失败：' + err.message, false); }
  finally { e.target.value = ''; }
};
if (typeof $('undoImport').hidden === 'boolean') updateUndoButton();
$('undoImport').onclick = async () => {
  try {
    const { migrationPrevious } = await get('migrationPrevious');
    if (!migrationPrevious) return updateUndoButton();
    const payload = AF.backup.prepareImport(migrationPrevious);
    await set(payload);
    await chrome.storage.local.remove('migrationPrevious');
    await refreshRestoredData();
    await updateUndoButton();
    say('undoMsg', '已恢复导入前的本机数据');
  } catch (err) { say('undoMsg', '撤销失败：' + err.message, false); }
};

loadProfile(); loadCities(); loadAnswers(); loadMemories(); loadFiles(); loadAi();
