// 调试用：在网页主环境里代替插件后台，答案来自 window.__af 表；没答案的字段/选项记下来交给离线 AI。
(() => {
  const T = window.__af = window.__af || { profile: null, values: {}, picks: {}, need: [], pickNeed: [] };
  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    lastError: null,
    sendMessage(msg, cb) {
      let r = {};
      if (msg.type === 'STATE') r = { profile: T.profile, autoExpand: true };
      else if (msg.type === 'RESOLVE') {
        const values = {}, source = {};
        for (const f of msg.fields) {
          const k = f.key + (f.options?.length ? '#opts' : '');
          if (k in T.values) { values[f.key] = T.values[k]; source[f.key] = 'AI'; }
          else if (!T.need.some(x => x.key === f.key && !!x.options === !!f.options)) T.need.push(f);
        }
        r = { values, source };
      } else if (msg.type === 'PICK') {
        const k = msg.field.key + '|' + msg.value + '|' + msg.options.slice(0, 5).join(',');
        if (k in T.picks) r = { index: msg.options.indexOf(T.picks[k]) };
        else { if (!T.pickNeed.some(x => x.key === k)) T.pickNeed.push({ key: k, field: msg.field, value: msg.value, options: msg.options }); r = { index: -1 }; }
      } else if (msg.type === 'REMEMBERED') r = { values: {} };
      setTimeout(() => cb && cb(r), 0);
    },
  };
})();
