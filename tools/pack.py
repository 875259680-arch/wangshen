#!/usr/bin/env python3
"""打包成可独立安装的插件（Chrome / Edge 通用）。

用法：
  python3 tools/pack.py            # 仅打包插件程序，不含个人资料
  python3 tools/pack.py --no-data  # 兼容旧命令，效果相同

个人资料请使用插件设置页单独导出的备份迁移；不提供含个人资料的分发包。

输出：dist/wangshen-autofill-<版本>-nodata/ 和同名 .zip（zip 内文件名按 UTF-8 标记，Windows 资源管理器可直接解压）。
"""
import json, shutil, sys, zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text('utf-8'))['version']
if '--with-data' in sys.argv or '--data' in sys.argv:
    raise SystemExit('拒绝打包个人数据。请在插件“资料与设置 → 备份与迁移”中单独导出或导入备份。')
unknown = set(sys.argv[1:]) - {'--no-data'}
if unknown:
    raise SystemExit(f'未知参数：{", ".join(sorted(unknown))}')
name = f'wangshen-autofill-{version}-nodata'
dist = root / 'dist'
out = dist / name

INCLUDE = ['manifest.json', 'README.md', 'icons', 'src']
SKIP = {'.DS_Store', 'Thumbs.db'}

GUIDE = f"""网申助手 v{version} 安装说明（Microsoft Edge / Google Chrome，Windows 和 Mac 通用）

一、安装（约 1 分钟）
1. 把整个文件夹解压到一个固定位置，例如 D:\\网申助手\\{name}
   更新时覆盖原文件夹并保持路径不变，浏览器就继续使用原扩展的 chrome.storage.local 数据。
2. Edge 地址栏输入 edge://extensions 回车（Chrome 是 chrome://extensions）。
3. 打开左侧（Chrome 在右上角）的“开发人员模式”。
4. 点“加载解压缩的扩展”，选择含有 manifest.json 的那一层文件夹。
5. 装过旧版“网申助手”或“本地网申助手”的，先在扩展页把旧的关闭，两个同时开会抢着填。
6. 点地址栏右边的拼图图标，把“网申助手”固定到工具栏。

二、首次设置与迁移
本分发包不含 data/ 或个人资料，也不会从安装包自动导入或覆盖个人资料。资料、记住的回答、学习规则及其历史、补充项、附件、设置、API Key、简历、证件照和运行缓存保存在原浏览器的 chrome.storage.local。
要换电脑或浏览器，请在“资料与设置 → 备份与迁移”导出完整备份，再在新设备导入。默认勾选包含 API Key；导入会完整替换新设备现有数据，并在导入前保存本机数据，可点“撤销上次导入”恢复一次。
- 资料与设置 → 我的资料：顶部填“意向城市优先级”（如：上海、深圳、北京、浙江），点保存。
- 资料与设置 → 材料：把身份证正反面、学历学位证书、成绩单等放进去，网页上有对应上传框时自动上传。
- 迁移时：旧浏览器“资料与设置 → 备份与迁移 → 导出备份”；新浏览器同一位置选择备份文件导入。

三、使用
打开网申页面 → 右下角蓝色“申”按钮 → 一键填写（快捷键 Alt+Shift+F，可在 edge://extensions/shortcuts 修改）。
- 默认只填空着的格子；网页上已有、但和资料不一致的值（旧草稿、网站解析简历的错值）会单独列出，
  点“用资料覆盖”只改这几项。
- 面板“待处理”：要你自己填的；“可学习”：你手动改过的，逐条“记住”，以后自动填。
- 不会点保存、提交、投递，最后请你自己检查后提交。

四、常见问题
- “开发人员模式”是灰色的：公司电脑策略禁止加载本地扩展，需要 IT 开通。
- 每次启动 Edge 提示“关闭开发人员模式下的扩展”：点“保留”或关掉提示即可。
- 浏览器版本：建议 Edge / Chrome 111 以上（Moka、北森等平台的“直接写入”需要）；更老的版本会自动退回较慢的模拟点击方式。
  查看版本：edge://settings/help
- AI 连不上（公司网络拦截 api.deepseek.com）：资料能对上的、学到的规则照常填写，其余列入待处理。
- 更新插件：将新版文件解压并覆盖原插件文件夹，保持原来的固定路径不变，再到扩展页点“重新加载”并刷新网申页面。这样浏览器会继续使用原扩展身份及其 chrome.storage.local 数据。

五、隐私
网站诊断记录不包含在个人资料备份中；需要迁移时请在“网站诊断”页单独导出脱敏诊断。个人备份可能含资料、附件和 API Key，请妥善保管，不要随插件包分发。
身份证号、电话、邮箱不会发给 AI（发送前替换成占位符，回填时在本地还原）。“导出诊断”不含任何资料值。
"""


def copy(src: Path, dst: Path):
    if src.name in SKIP:
        return
    if src.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for c in sorted(src.iterdir()):
            copy(c, dst / c.name)
    else:
        shutil.copy2(src, dst)


if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)
for item in INCLUDE:
    if (root / item).exists():
        copy(root / item, out / item)
# 记事本友好：UTF-8 BOM + CRLF
(out / '安装说明.txt').write_bytes(b'\xef\xbb\xbf' + GUIDE.replace('\n', '\r\n').encode('utf-8'))

zpath = dist / f'{name}.zip'
zpath.unlink(missing_ok=True)
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(out.rglob('*')):
        if f.is_file():
            z.write(f, f'{name}/{f.relative_to(out).as_posix()}')
size = zpath.stat().st_size / 1024
print(f'{out.relative_to(root)}/\n{zpath.relative_to(root)}  ({size:.0f} KB, 不含个人数据)')
