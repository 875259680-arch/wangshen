// 离线调用插件后台的同一套逻辑（同一个提示词、隐私占位、缓存规则），用于在真实网页上调试：
//   node tools/offline.mjs resolve fields.json > values.json
//   node tools/offline.mjs pick picks.json > picked.json
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mem = {
  profile: JSON.parse(fs.readFileSync(path.join(root, 'data/seed.json'), 'utf8')).profile,
  settings: { model: 'deepseek-flash', ...JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8')) },
  profileRev: 1, answers: {}, cache: {}, picks: {},
};
const noop = { addListener() {} };
globalThis.chrome = {
  runtime: { onInstalled: noop, onStartup: noop, onMessage: noop, getURL: p => p },
  commands: { onCommand: noop },
  storage: { local: { get: async k => Object.fromEntries([].concat(k).map(x => [x, mem[x]])), set: async o => Object.assign(mem, o) } },
};
const code = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const api = new Function(code + '\nreturn { resolve, pickOption };')();
const [cmd, file] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
if (cmd === 'resolve') console.log(JSON.stringify((await api.resolve(input, { host: 'debug' })).values));
if (cmd === 'pick') {
  const out = {};
  for (const p of input) { const i = await api.pickOption(p.field, p.value, p.options); out[p.key] = i >= 0 ? p.options[i] : null; }
  console.log(JSON.stringify(out));
}
