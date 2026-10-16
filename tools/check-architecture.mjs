// Static checks only. Does not open a browser, execute extension logic or call an API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['tools/sync-manifest.mjs', '--check'], { cwd: root, stdio: 'inherit' });
const files = [];
function visit(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) visit(f); else if (/\.(m?js)$/.test(f)) files.push(f); } }
visit(path.join(root, 'src')); visit(path.join(root, 'tools'));
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const f of [manifest.background.service_worker, manifest.options_page, manifest.action.default_popup]) if (!fs.existsSync(path.join(root, f))) throw Error(`入口不存在：${f}`);
console.log(`静态检查完成：${files.length} 个 JS 文件语法及扩展资源路径；未运行功能测试。`);
