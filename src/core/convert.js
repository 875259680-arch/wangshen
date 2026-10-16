// 值格式转换：日期、起止时间、是/否。纯函数，各平台共用。
(() => {
  if (globalThis.AF?.convert) return;
  const AF = (globalThis.AF ||= {});
  const pad = n => String(n).padStart(2, '0');
  const NOW = /^(至今|现在|目前|在职|在读|present|now|till now|to date)$/i;

  // “2019-9”“2019.09”“2019年9月”“201909”“2019/09/01” → { y, m, d? }（字符串，两位补零）
  function parseDate(v) {
    const s = String(v ?? '').trim();
    let r = s.match(/((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2}))?/) || s.match(/^((?:19|20)\d{2})(\d{2})(\d{2})?$/);
    if (!r) { const y = s.match(/^((?:19|20)\d{2})\s*年?$/); return y ? { y: y[1], m: '01', d: null, yearOnly: true } : null; }
    const [, y, m, d] = r;
    if (+m < 1 || +m > 12 || (d && (+d < 1 || +d > 31))) return null;
    return { y, m: pad(m), d: d ? pad(d) : null };
  }
  // 起止时间：{start,end} 对象，或“2019-09 ~ 2023-06”“2025.04-2025.08”“2026-08 至今”
  function parseRange(v) {
    let a, b;
    if (v && typeof v === 'object') { a = v.start; b = v.end; }
    else {
      const s = String(v ?? '').trim();
      const parts = s.split(/\s*(?:~|～|至(?!今)|到|—|–|\s-\s)\s*/).filter(Boolean);
      if (parts.length >= 2) [a, b] = parts;
      else { const m = s.match(/^(.+?\d)\s*-\s*((?:19|20)\d{2}.*|至今)$/) || s.match(/^(.+?)\s*(至今|present|now)$/i); if (m) [, a, b] = m; else a = s; }
    }
    const start = a ? parseDate(a) : null, now = NOW.test(String(b ?? '').trim()), end = b && !now ? parseDate(b) : null;
    if (!start && !end && !now) return null;
    return { start, end, now };
  }
  const yesNo = v => {
    const t = String(v ?? '').trim();
    if (/^(是|有|yes|y|true|1|愿意|接受|同意|服从)$/i.test(t)) return true;
    if (/^(否|无|没有|no|n|false|0|不愿意|不接受|不同意|不服从)$/i.test(t)) return false;
    return null;
  };
  // 年月比较（“2025-9”与“2025-09”相同）
  const sameYM = (a, b) => {
    if (!a && !b) return true;
    if (NOW.test(String(a ?? '')) || NOW.test(String(b ?? ''))) return NOW.test(String(a ?? '')) && NOW.test(String(b ?? ''));
    const x = parseDate(a), y = parseDate(b);
    return !!x && !!y && x.y === y.y && x.m === y.m;
  };
  // 按平台声明的格式输出：yyyy/MM/dd、yyyy-MM、yyyy/MM ……
  const format = (d, fmt = 'yyyy-MM-dd') => fmt.replace(/yyyy/i, d.y).replace(/MM/, d.m).replace(/dd/i, d.d || '01');

  AF.convert = { parseDate, parseRange, yesNo, sameYM, format, NOW };
})();
