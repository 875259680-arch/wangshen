# 本地 Codex：接入和修复网站

先阅读根目录 AGENTS.md 和 ARCHITECTURE.md。类型接口见 `src/contracts.d.ts`，旧纯函数接口继续保留。

## 新增类型

```bash
npm run adapter:new -- example careers.example.com
```

脚手架生成 `src/adapters/example/{page,mapping}.js`，登记 catalog，默认 `enabled:false`。空壳不会进入生产加载清单。

1. 从真实页面提取脱敏字段结构，放进 `test/cases/example/`。记录 URL 模式、组件线索、区块和重复行；不要记录简历值或登录令牌。
2. 实现 page.js 的 detect/list/writeMany/focus/mark。detect 必须核对真实 DOM/组件，list 输出稳定 key、id、group、row、type、label、raw、options、required；错误反馈放 validationError。
3. 实现 mapping.js 的 kind/target/options/encode/decode/same/section/addArg/listOf。target 返回 `{sem}` 或 `{list,prop}`，不直接返回个人答案。单个字段无法支持时返回明确错误，不能随意猜值。
4. 教育、工作等页面可通过 section 推导，也可在字段上显式声明 pageType。使用 domKey 时必须来自同一次页面的 `AF.scan.scan()`，不能猜 selector。
5. 如需添加条目、条件开关、地区字典或附件，参考现有类型的 initialize/prepare/lookup/listOfGroup/markNone。保持“展开→重新解析→填写→读回”顺序。
6. 确认接入完整后把 enabled 设为 true，执行 `npm run sync`、`npm run check`，再开展真实浏览器测试。修改 catalog 后提交自动生成的 manifest 和 runtime/catalog.js。

## 同类型的公司差异

在 `src/adapters/overrides.js` 注册小范围覆盖，复杂公司可建 `src/adapters/<类型>/sites/<公司>.js` 并加入 catalog 的 isolatedExtras（支持文件清单扩展）。覆盖不会另建一套资料或复制整个类型。

```javascript
AF.adapters.registerOverride({
  id: 'moka-example-education', platform: 'moka', version: '0.1.0', priority: 100,
  match: context => context.siteScope === 'app.mokahr.com:example',
  pageTypes: ['education'],
  methods: {
    target(field) {
      if (field.id === 'verified_custom_graduation_field') return { list: 'edu', prop: 'end' };
      return AF.platforms.moka.target(field);
    }
  }
});
```

以上示例不会自动注册。用真实公司租户/字段证据替换；其他字段回调基础类型。最高 priority 的覆盖生效，同优先级按 id 排序，避免依赖文件偶然加载顺序。

涉及页面组件实现的差异可先在所属类型 page.js 内用独立 helper 处理；需要独立 page.js 时可登记新类型 ID，复用原 mapping 的方法。不向 MAIN world 发送资料。

## 开发闭环

记录失败 → 页面面板或设置页导出诊断 → 按 moduleId 找文件 → 修复对应模块 → 单元回归 → 真实网页读回 → 保存脱敏样本。诊断不含具体答案，排查时如确需原始数据，由用户在本地查看，不上传到仓库。

`npm run check` 只做语法与资源检查，不能替代 `npm test` 和浏览器验证。只有跨多个平台都复现的相同问题才考虑修改 core 或 workflow。
