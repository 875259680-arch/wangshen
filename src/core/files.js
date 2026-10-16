// 材料：上传框的名称 → 材料种类 → 你存的文件。种类表也是设置页“材料”一栏的列表。
// 顺序有讲究：“身份证”要排在“证书”前面，“学历/学位证书”要排在“其他证书”前面。
(() => {
  if (globalThis.AF?.files) return;
  const AF = (globalThis.AF ||= {});

  const KINDS = [
    ['简历', /简历|resume|\bcv\b/i],
    ['证件照', /证件照|免冠|头像|个人照片|^照片|photo/i],
    ['身份证正面', /身份证.{0,4}(正面|人像)/],
    ['身份证反面', /身份证.{0,4}(反面|背面|国徽)/],
    ['海外学历认证', /海外|留学|学历认证|学位认证/],
    ['学历学位证书', /学历|学位|毕业证/],
    ['成绩单', /成绩单|成绩证明|成绩表/],
    ['学籍验证报告', /学籍/],
    ['英语证书', /英语|四级|六级|cet|雅思|托福|ielts|toefl/i],
    ['银行卡', /银行卡/],
    ['体检报告', /体检/],
    ['获奖证书', /获奖|奖状|荣誉/],
    ['其他证书', /证书|资格证|职称/],
  ];
  const kindOf = label => (KINDS.find(([, re]) => re.test(String(label || ''))) || [])[0] || null;
  // files：[{ id, kind, name }]（不含内容）
  const match = (label, files) => { const k = kindOf(label); return k ? (files || []).find(f => f.kind === k) || null : null; };

  AF.files = { KINDS: KINDS.map(([k]) => k), kindOf, match };
})();
