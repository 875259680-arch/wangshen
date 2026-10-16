// Attachment workflow shared by platform adapters. No storage is read except through send.
(() => {
  const AF = globalThis.AF;
  AF.attachments = { create({ send, emit, sleep, empty, isCancelled }) {
  // ---------- 简历：先传、等网站解析完再填 ----------
  // 很多网申页顶部有“上传简历，帮你快速解析”，Moka 的简历字段也写着“上传后会自动解析、填充申请表”。
  // 这类上传会让网站用简历改写表单，必须排在最前面：先传、等解析完，插件再补空白、列出解析错的值。
  // 3.3.0 把顶部这个入口漏了（它不是表单字段），“上传材料”在这类页面上直接说“没有上传框”。
  const RESUME = /简历|resume|\bcv\b/i, PARSES = /解析|自动填|快速填写|导入简历|识别/;
  function parseZones() {
    return [...document.querySelectorAll('input[type=file]')].filter(i => {
      if (i.disabled || i.files.length || i.closest('#af-panel-host')) return false;
      let t = '';
      for (let c = i.parentElement, k = 0; c && k < 6 && !t.trim(); c = c.parentElement, k++) t = c.innerText || '';
      return RESUME.test(t) && PARSES.test(t);
    });
  }
  function domUpload(input, file) {
    const bin = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], file.name, { type: file.mime }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const filledCount = (plat, list) => list.filter(f => !['file', 'consent', 'unknown'].includes(plat.kind(f)) && !empty(f.raw)).length;
  async function resumeFirst(plat, early, files, results) {
    const fields = early.filter(f => plat.kind(f) === 'file' && empty(f.raw) && RESUME.test(f.label) && PARSES.test(f.hint || ''));
    const zones = parseZones();
    const handled = new Set(fields.map(f => f.key));
    if (!fields.length && !zones.length) return handled;
    const key = fields[0]?.key || 'resume-parse', label = fields[0]?.label || '上传简历（网站自动解析）';
    const resume = files.find(f => f.kind === '简历');
    if (!resume) { results.push({ key, label, section: '', required: true, state: 'nodata', reason: '还没有存简历：在“资料与设置 → 材料”里添加' }); return handled; }
    // Hotjob 的“上传文件简历”解析完直接存进你在网站上的简历（不用点保存），会把已存的学校、专业、证书改掉
    // （2026-10-13 实测踩过）。这类网站一键填写绝不自动传，要用网站解析请自己点“上传材料”。
    if (plat.parseSaves) {
      results.push({ key, label, section: '', state: 'nodata', reason: '这个网站解析简历后会直接改写你存在网站上的简历，插件不自动上传；需要时点“上传材料”' });
      return handled;
    }
    const before = filledCount(plat, early);
    if (before > 3) {
      results.push({ key, label, section: '', state: 'nodata', reason: '网页已有内容，没有自动上传简历（网站解析会改写已填的内容）；需要时点“上传材料”' });
      return handled;
    }
    emit({ status: '先上传简历，等网站解析…' });
    const file = await send({ type: 'GET_FILE', id: resume.id });
    if (!file?.base64) { results.push({ key, label, section: '', state: 'fail', reason: '简历文件读不出来' }); return handled; }
    for (const f of fields) await AF.rpc('upload', f.key, { name: file.name, mime: file.mime, base64: file.base64 }).catch(() => {});
    for (const z of parseZones()) domUpload(z, file);   // 平台字段和顶部入口是同一个上传框时，上一步已经放了文件，这里自动跳过
    // 等解析：已填字段数涨上去、并稳定 1.5 秒；最长 15 秒
    let last = before, stable = 0, grew = false;
    for (let t = 0; t < 30 && !isCancelled(); t++) {
      await sleep(500);
      const n = filledCount(plat, await AF.rpc('list').catch(() => []));
      if (n > before) grew = true;
      stable = n === last ? stable + 1 : 0; last = n;
      if (grew && stable >= 3) break;
    }
    results.push({ key, label, section: '', state: 'ok', value: grew ? `已上传 ${file.name}，网站解析填了 ${last - before} 项` : `已上传 ${file.name}（网站没有解析出内容）`, source: '材料' });
    return handled;
  }

  // ---------- 材料上传 ----------
  // 按上传框的名称匹配你在“资料与设置 → 材料”里放的文件（core/files.js），文件内容按需从后台取。
  async function uploadFiles(plat, list, results, entryOf, files) {
    emit({ status: `上传材料（${list.length} 个上传框）…` });
    const started = [];
    for (const f of list) {
      if (isCancelled()) break;
      const m = AF.files.match(f.label, files);
      if (!m) { results.push({ ...entryOf(f), state: 'nodata', reason: AF.files.kindOf(f.label) ? `还没有上传“${AF.files.kindOf(f.label)}”，可在“资料与设置 → 材料”里添加` : '没有对应的材料' }); continue; }
      try {
        const file = await send({ type: 'GET_FILE', id: m.id });
        if (!file?.base64) throw Error('材料文件读不出来');
        await AF.rpc('upload', f.key, { name: file.name, mime: file.mime, base64: file.base64 });
        started.push({ f, name: file.name });
      } catch (e) { results.push({ ...entryOf(f), state: 'fail', reason: `上传失败：${e.message || e}` }); }
    }
    // 网页收到文件后要传到它自己的服务器，几秒后字段里才有值：全部发出后一起等，以字段真的有值为准
    const pending = new Map(started.map(x => [x.f.key, x]));
    const uploadWaitMs = plat.uploadTimeoutMs || 15000;
    for (let t = 0; t < Math.ceil(uploadWaitMs / 500) && pending.size && !isCancelled(); t++) {
      await sleep(500);
      const now = new Map((await AF.rpc('list').catch(() => [])).map(f => [f.key, f]));
      for (const [k, x] of pending) if (now.get(k) && !empty(now.get(k).raw)) { results.push({ ...entryOf(x.f), state: 'ok', value: `已上传 ${x.name}`, source: '材料' }); pending.delete(k); }
    }
    for (const x of pending.values()) results.push({ ...entryOf(x.f), state: 'nodata', reason: `已交给网站，${uploadWaitMs / 1000} 秒内尚未收到上传完成回执；状态未确认，再次填写会重新检查` });
    emit({ results });
  }
    return { resumeFirst, uploadFiles, parseZones, domUpload };
  } };
})();
