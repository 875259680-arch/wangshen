// Moka（app.mokahr.com）：字段 id、块、值格式都来自 2026-10-12 真实申请页（test/cases/moka/）。
// 页面侧（adapters/moka/page.js）只负责列出组件原始数据、写原始值；这里决定“对应什么、写成什么格式”，全部是纯函数。
(() => {
  const AF = (globalThis.AF ||= {});
  (AF.platforms ||= {});
  if (AF.platforms.moka) return;
  const { best, norm } = AF.text;
  const D = () => AF.convert;

  // 内置字段 id → 语义键（不随公司变）
  const SINGLE_ID = { name: 'name', phone: 'phone', email: 'email', gender: 'gender', birthDate: 'birthDate', nationality: 'nationality',
    ethnic: 'ethnicity', nativePlace: 'hometown', aimSalary: 'expectedSalary', aimWorkCity: 'cityPref', forwardLocation: 'cityPref' };
  // 多条目块 → 资料列表
  const BLOCK = { educationInfo: 'edu', experienceInfo: 'workOrIntern', internshipInfo: 'intern', projectInfo: 'project',
    practiceInfo: 'campus', familyInfo: 'family' };
  const LIST_ID = { startDate: 'range', school: 'school', speciality: 'major', academicDegree: 'degree', company: 'company',
    title: 'title', summary: 'desc', projectName: 'name', projectDescription: 'desc' };
  // Moka 字段类型 → 通用控件种类
  const KIND = { string_info: 'text', text_info: 'textarea', number_info: 'number', select: 'select', Select: 'select', select_info: 'select',
    bool_info: 'bool', day_info: 'date', date_info: 'range', location_info: 'region', cascader: 'select', file_upload: 'file', confirm_info: 'consent' };

  const kind = f => KIND[f.type] || 'unknown';

  function target(f) {
    const list = BLOCK[f.group] || null;
    if (list && LIST_ID[f.id]) return { list, prop: list === 'project' && f.id === 'title' ? 'role' : LIST_ID[f.id] };
    if (!list && SINGLE_ID[f.id]) return { sem: SINGLE_ID[f.id] };
    return AF.mapping.byLabel(f.label, list);
  }

  // 选项统一成 [{text, value}]。内置下拉是 {label,value}；自定义下拉是字符串；城市/站点是对象树。
  function options(f) {
    const out = [];
    for (const o of f.options || []) {
      if (typeof o === 'string') out.push({ text: o, value: o });
      else if (o.sites) for (const s of o.sites) out.push({ text: `${o.cityName}/${s.name}`, value: s.id });
      else if (o.label != null) out.push({ text: String(o.label), value: o.value });
      else if (o.cityName != null) out.push({ text: o.cityName, value: o.cityName });
      else if (o.name != null) out.push({ text: o.name, value: o.value ?? o.id ?? o.name });
    }
    return out;
  }

  // 人能看懂的值 → Moka 原始值。返回 { raw } 或 { pick: [选项文字] }（要 AI 在选项里挑）或 { error }。
  function encode(f, v, ctx = {}) {
    const k = kind(f);
    if (k === 'text' || k === 'textarea') return { raw: String(v) };
    if (k === 'number') { const n = String(v).match(/\d+(\.\d+)?/); return n ? { raw: n[0] } : { error: `“${v}”不是数字` }; }
    if (k === 'bool') { const b = D().yesNo(v); return b == null ? { error: `“${v}”不是“是/否”` } : { raw: b ? 1 : 0 }; }
    if (k === 'select') {
      const opts = options(f);
      const hit = best(String(v), opts, o => o.text);
      return hit.score >= 0.8 ? { raw: hit.item.value } : { pick: opts.map(o => o.text) };
    }
    if (k === 'date') {
      const d = D().parseDate(v);
      // 和 Moka 自己的日历一样存“本地当天 0 点”；以前写成北京时间 0 点，洛杉矶时区下显示成前一天/前一月。
      return d ? { raw: new Date(+d.y, +d.m - 1, +(d.d || 1)).getTime() } : { error: `无法识别日期“${v}”` };
    }
    if (k === 'range') {
      const r = D().parseRange(v);
      if (!r) return { error: `无法识别起止时间“${typeof v === 'object' ? JSON.stringify(v) : v}”` };
      // 没有“至今”（教育经历 allowNow=false）：网页要明确的结束时间点，填今天所在的年月
      if (r.now && f.allowNow === false) {
        const t = D().parseDate(ctx.today || new Date().toISOString().slice(0, 10));
        return { raw: { start: r.start ? `${r.start.y}-${r.start.m}` : '', end: `${t.y}-${t.m}` }, note: '网页没有“至今”，结束时间已填本月' };
      }
      return { raw: { start: r.start ? `${r.start.y}-${r.start.m}` : '', end: r.now ? '至今' : r.end ? `${r.end.y}-${r.end.m}` : '' } };
    }
    if (k === 'region') {
      const hit = AF.region.resolve(AF.region.gb(), v);
      return hit ? { raw: hit.id } : { error: `地区表里找不到“${v}”` };
    }
    return { error: '这类控件不自动填写' };
  }

  // 原始值 → 文字（回读核验、记住手动修改时用）
  function decode(f, raw) {
    if (raw == null || raw === '') return '';
    const k = kind(f);
    if (k === 'select') { const o = options(f).find(x => String(x.value) === String(raw)); return o ? o.text : String(raw); }
    if (k === 'bool') return raw === 1 || raw === true || raw === '1' ? '是' : raw === 0 || raw === false || raw === '0' ? '否' : '';
    if (k === 'date') { const t = new Date(+raw); return isNaN(t) ? '' : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
    if (k === 'range') return raw && (raw.start || raw.end) ? `${raw.start || ''} ~ ${raw.end || ''}` : '';
    if (k === 'region') return AF.region.nameOf(AF.region.gb(), raw) || String(raw);
    return String(raw);
  }
  const same = (f, a, b) => {
    if (kind(f) === 'range') return D().sameYM(a?.start, b?.start) && (D().sameYM(a?.end, b?.end) || (!b?.end && !a?.end));
    return norm(decode(f, a)) === norm(decode(f, b));
  };

  const SECTION = { basicInfo: '基本信息', applyInfo: '申请信息', jobIntention: '求职意向', educationInfo: '教育经历', experienceInfo: '工作经历', projectInfo: '项目经历', selfDescription: '自我描述' };
  const section = f => f.groupTitle || SECTION[f.group] || '';

  // 补条目时传给页面侧的参数：Moka 按块 id 找“添加”按钮
  const addArg = f => f.group;

  const listOf = f => BLOCK[f.group] || null;

  AF.platforms.moka = { name: 'Moka', kind, target, options, encode, decode, same, section, addArg, listOf };
})();
