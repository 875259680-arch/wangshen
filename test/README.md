# 测试目录

本轮整理了测试源码，但没有执行功能测试。`npm run check` 只校验语法与扩展资源，不执行下面的断言。

| 文件 | 保留理由 |
|---|---|
| core.test.mjs | 多平台字段语义、格式转换、地区及资料映射 |
| job51-classic.test.mjs | 51job 经典页真实字段样本 |
| job51-modern.test.mjs | 51job 卡片页、重复经历及字典格式 |
| beisen-live.test.mjs | 北森真实字段快照（名称含 live，但不是浏览器自动化） |
| memory-legacy.test.mjs | 旧字段身份、重复行和兼容匹配；不等于生产隔离测试 |
| background.test.mjs | 存储初始化、队列、历史记录、作用域、缓存及诊断 |
| backup.test.mjs | 旧备份兼容、完整恢复、无损保留历史 |
| diag.test.mjs | 路径和原因脱敏、诊断聚合 |
| cases/ | 真实网站的结构样本，保留给本地 Codex 回归使用 |

已删除：要求跨网站自动复用答案的旧正向用例及混合测试中的对应断言。后台测试加载路径、上下文和缓存样本已对齐新结构；未宣称测试通过。

下一步由本地 Codex 增加 scoped-memory 的生产入口隔离用例，并执行 `npm test` 和真实网页验证。不要只运行旧匹配器测试就宣布网站隔离有效。诊断输出放 `test/out/`，该目录不进入版本管理。
