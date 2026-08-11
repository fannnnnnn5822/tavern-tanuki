// 酒馆小狸 动态加载器：连接器本体托管 GitHub dist/connector.js（jsDelivr 三域备胎）
// 版本指针在 Supabase sb_config.tanuki_script_ref（@提交号=全新路径必回源，绕开 CDN 12h 缓存=发版秒切）；指针失联退回 @main
// 本体源码: https://github.com/fannnnnnn5822/tavern-tanuki/blob/master/dist/connector.js
(async function () {
  var ref = 'main';
  try {
    var c0 = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t0 = c0 ? setTimeout(function () { c0.abort(); }, 6000) : null;
    var r0 = await fetch('https://hieylivlsdmyznviumht.supabase.co/rest/v1/sb_config?key=eq.tanuki_script_ref&select=value', {
      cache: 'no-store', signal: c0 ? c0.signal : undefined,
      headers: {
        'apikey': 'sb_publishable_MH80Xnlm1oHli6UXwzRpNA_EsC1DnCO',
        'Authorization': 'Bearer sb_publishable_MH80Xnlm1oHli6UXwzRpNA_EsC1DnCO',
      },
    });
    if (t0) clearTimeout(t0);
    if (r0.ok) {
      var j0 = await r0.json();
      var v0 = j0 && j0[0] && String(j0[0].value || '').trim();
      if (v0 && /^[\w.\-]{4,60}$/.test(v0)) ref = v0; // 只认提交号/标签这种干净字符，防路径注入
    }
  } catch (e0) { console.warn('[小狸 loader] 版本指针拉取失败，退回 @main', e0); }
  var urls = ['testingcf.jsdelivr.net', 'fastly.jsdelivr.net', 'cdn.jsdelivr.net'].map(function (h) {
    return 'https://' + h + '/gh/fannnnnnn5822/tavern-tanuki@' + ref + '/dist/connector.js';
  });
  var code = null, lastErr = null;
  for (var i = 0; i < urls.length; i++) {
    try {
      // 被墙的域不是报错是挂死——12秒闸刀，砍了换下一个源
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
      var resp = await fetch(urls[i], { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      code = await resp.text();
      if (!code || code.length < 500) throw new Error('内容异常(' + (code ? code.length : 0) + ' chars)');
      console.log('[小狸 loader] connector.js via ' + urls[i].split('/')[2] + ' @' + ref + ' (' + code.length + ' chars)');
      break;
    } catch (e) { lastErr = e; code = null; console.warn('[小狸 loader] connector.js 源' + (i + 1) + '失败，换下一个', e); }
  }
  if (code == null) {
    try { toastr.error('小狸连接器加载失败（三个源都不通，多半是断网，刷新酒馆重试）：' + ((lastErr && lastErr.message) || lastErr), '酒馆小狸'); } catch (e2) {}
    console.error('[小狸 loader] connector.js all sources failed', lastErr);
    return;
  }
  try { eval(code); } catch (e3) {
    try { toastr.error('小狸连接器执行出错：' + ((e3 && e3.message) || e3), '酒馆小狸'); } catch (e4) {}
    console.error('[小狸 loader] connector.js eval failed', e3);
  }
})();
