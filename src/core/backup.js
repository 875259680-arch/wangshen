// Full local-data backup format. This module only prepares data; callers own storage writes.
(() => {
  const APP = 'wangshen-autofill';
  const DATA_KEYS = [
    'profile', 'answers', 'memories', 'supplement', 'files', 'settings',
    'resume', 'photo', 'profileRev', 'cache', 'picks', 'seedVersion',
  ];
  const OBJECT_KEYS = ['profile', 'answers', 'memories', 'supplement', 'files', 'settings', 'resume', 'photo', 'cache', 'picks'];
  const DEFAULTS = Object.fromEntries(DATA_KEYS.map(key => [key,
    OBJECT_KEYS.includes(key) ? {} : 0,
  ]));

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value, path = 'data') {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map((item, i) => cloneJson(item, `${path}[${i}]`));
    if (isObject(value)) {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        Object.defineProperty(out, key, { value: cloneJson(item, `${path}.${key}`), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    throw new TypeError(`${path} 包含不支持的数据类型`);
  }

  function normalizeData(input, { rejectUnknown = true } = {}) {
    if (!isObject(input)) throw new TypeError('备份 data 必须是对象');
    const unknown = Object.keys(input).filter(key => !DATA_KEYS.includes(key));
    if (rejectUnknown && unknown.length) throw new TypeError(`备份 data 含未知字段：${unknown.join(', ')}`);

    const data = { ...DEFAULTS };
    for (const key of DATA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) data[key] = cloneJson(input[key], `data.${key}`);
    }
    for (const key of OBJECT_KEYS) {
      if (!isObject(data[key])) throw new TypeError(`data.${key} 必须是对象`);
    }
    for (const key of ['answers', 'memories', 'supplement', 'files']) {
      for (const [id, item] of Object.entries(data[key])) {
        if (!isObject(item)) throw new TypeError(`data.${key}.${id} 必须是对象`);
      }
    }
    for (const key of ['profileRev', 'seedVersion']) {
      if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0) {
        throw new TypeError(`data.${key} 必须是非负数`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(data.settings, 'apiKey') && typeof data.settings.apiKey !== 'string') {
      throw new TypeError('data.settings.apiKey 必须是字符串');
    }
    return data;
  }

  function build(inputData, options = {}) {
    const { extensionVersion = '', exportedAt = new Date().toISOString(), includeApiKey = true } = options;
    if (typeof extensionVersion !== 'string') throw new TypeError('extensionVersion 必须是字符串');
    if (typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt))) throw new TypeError('exportedAt 必须是有效时间');
    if (typeof includeApiKey !== 'boolean') throw new TypeError('includeApiKey 必须是布尔值');
    const data = normalizeData(inputData, { rejectUnknown: false });
    if (!includeApiKey) data.settings.apiKey = '';
    return { schemaVersion: 1, app: APP, extensionVersion, exportedAt, data };
  }

  function parse(input) {
    let backup;
    try {
      backup = typeof input === 'string' ? JSON.parse(input) : input;
    } catch (_) {
      throw new TypeError('备份文件不是有效 JSON');
    }
    if (!isObject(backup)) throw new TypeError('备份必须是 JSON 对象');
    if (backup.app !== APP) throw new TypeError('不是网申助手的备份文件');
    const legacy = backup.schemaVersion === undefined;
    if (legacy) {
      if (typeof backup.version !== 'string') throw new TypeError('旧版备份缺少 version');
    } else if (backup.schemaVersion !== 1) {
      throw new TypeError(`不支持的备份版本：${backup.schemaVersion}`);
    }
    const extensionVersion = legacy ? backup.version : backup.extensionVersion;
    if (typeof extensionVersion !== 'string') throw new TypeError('extensionVersion 必须是字符串');
    if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) {
      throw new TypeError('exportedAt 必须是有效时间');
    }
    const data = normalizeData(backup.data);
    return { schemaVersion: 1, app: APP, extensionVersion, exportedAt: backup.exportedAt, data };
  }

  function prepareImport(input) {
    const backup = parse(input);
    // The bundled seed must never replace a restored profile, even when its version is newer.
    return { ...backup.data, seedVersion: Number.MAX_SAFE_INTEGER };
  }

  const api = { build, parse, prepareImport, dataKeys: [...DATA_KEYS] };
  const AF = (globalThis.AF ||= {});
  AF.backup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
