# 3.9 模块框架

本次是架构交付，未进行浏览器功能验证；不要据此宣称任一网站回归通过。

## 目录职责

| 目录 | 职责 | 不应放入 |
|---|---|---|
| `src/core/` | 统一资料事实、字段语义、日期地区转换、基础工具、材料分类 | 公司专属选择器与补丁 |
| `src/adapters/<类型>/mapping.js` | 该类型字段映射、格式转换、模块可选生命周期 | chrome.storage 操作 |
| `src/adapters/<类型>/page.js` | MAIN world 页面识别、原始字段读取、组件写入、读回 | 简历资料、API Key、AI 调用 |
| `src/adapters/registry.js` | 统一接口、公司覆盖层、按字段页面类型选择规则 | 特定公司硬编码 |
| `src/adapters/catalog.json` | 模块 ID、版本、主机提示、加载顺序和入口 | 学习数据和个人资料 |
| `src/runtime/` | 跨 world 通信、注入资源、网站/租户/页面类型上下文 | 答案生成 |
| `src/workflow/` | 任务调度、结果管理、附件流程 | 各公司控件选择器 |
| `src/learning/` | 历史匹配算法、作用域隔离、显式共享和绑定 | 未经确认的跨网站推广 |
| `src/diagnostics/` | 失败分类、脱敏、诊断包格式 | 原始资料、完整 DOM、表单答案 |
| `src/storage/` | 旧备份格式兼容及迁移工具 | 页面控件行为 |
| `src/fallback/` | 陌生站点 DOM 填充、已知站点逐字段兜底 | 具体公司补丁 |
| `src/pages/`、`src/ui/` | 设置、弹窗、页面面板 | 网站适配业务 |
| `src/background.js` | 存储、消息和 AI 服务入口，保留现有接口 | 新公司字段补丁 |
| `templates/adapter/`、`tools/` | 新模块脚手架、加载清单同步、开发服务及打包 | 生产环境自动修改代码 |

## 实际调用关系

1. MAIN world 注册各 `page.js`；`detect()` 综合适配器自己的域名和组件结构检查，命中多个时用 catalog 的 priority 排序。catalog.hosts 仅是“等待页面加载”的提示，不会仅凭域名认定可填写。
2. `workflow/engine.js` 通过 RPC 得到类型 ID，再调用 `AF.adapters.resolve(id, pageContext)` 得到复合适配器。
3. `parse → mapField → resolveValue → convertValue → execute → verify` 分开进行。现有 encode、same 等纯函数继续保留，registry 提供统一外观。
4. `AF.context.field` 为每个字段附加 platform、host、siteScope、pageType。长表单的教育、工作等区块分别形成页面类型；适配器可显式设置 pageType。
5. 公司覆盖层优先于类型规则；覆盖层的 `pageTypes` 只限制对应字段。类型内仍可复用原始映射和组件操作。
6. 未识别整站时走 `domEngine`。已识别站点中未解决的字段走 `fieldFallback`，仅允许精确 domKey 或唯一的“题目 + 区块 + 行号”定位；存在多个候选就待确认，不重新跑整页。
7. 写入后用页面实际值核验。适配器返回 validationError 时不得标成功。未提供此信息的旧适配器只能进行原有值比较，网页校验提示需要本地继续接入。
8. 学习和诊断分别经过隔离与脱敏层，再通过后台存储；原数据键不重命名。

## 硬边界

- 不能把 execute 返回成功当作填充成功，必须 parse 读回后 verify。
- `page.js` 不得接触统一个人资料；两端通过 JSON 交换必要字段。
- 公共语义映射只接受真正跨平台成立的规则；公司特例必须放在对应模块。
- 通用字段兜底不覆盖非空值，不自动保存、提交、投递，也不自动上传附件。
- 公司差异或页面类型差异先使用覆盖层；全新招聘系统才增加 catalog 类型。
- 类型级学习仅显式提升资料映射，固定个人答案不自动推广。特殊控件行为由代码模块实现，不从导入 JSON 执行脚本。

## 保留的技术债

`background.js` 的旧 AI 服务和 DOM 本地回答规则仍集中在原入口；本次未重写这套提示词与规则，以免在没有实测时同时改变所有网站。`core/profile.js` 仍有默认国籍、声明类默认“否”等历史推断；不能把它们解释成经过核实的用户事实。本地迭代应优先审计这些默认值并按“缺资料则待确认”收紧。重复经历目前仍主要按 row 对应，基于学校/公司/日期的稳定实体匹配尚未实现。
