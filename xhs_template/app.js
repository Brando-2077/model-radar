/* ═══ 模型雷达 · 小红书竖屏版 v2.1 —— 置信带版 ═══
   结构：数据接入 → 纯计算 → 状态/深链 → 渲染 → 事件。ES2017 上限。 */
(function () {
  'use strict';
  window.onerror = function (msg, src, line) {
    var e = document.getElementById('err');
    e.style.display = 'block';
    e.textContent = '页面脚本出错：' + msg + ' @' + line;
  };

  /* ── 1. 数据接入 ─────────────────────────────────────────────── */
  var L = window.RADAR_LEDGER || null;
  if (!L || !L.models || !L.models.length) {
    var e0 = document.getElementById('err');
    e0.style.display = 'block';
    e0.textContent = '没有数据：data.js 缺失或损坏。';
    return;
  }
  var ALL = L.models, META = L.meta || {}, EV = L.evidence || [], SCENES = L.scenarios;
  var DIMS = L.dimensions.map(function (d) { return d.name; });
  var DIM_INFO = {}, DIM_DESC = {}, DIM_ALIAS = {};
  L.dimensions.forEach(function (d) {
    DIM_INFO[d.name] = d; DIM_DESC[d.name] = d.desc || '';
    if (d.alias) DIM_ALIAS[d.name] = d.alias;
  });
  var MODEL_IX = {};
  ALL.forEach(function (m) { MODEL_IX[m.name] = m; });
  var EVIDX = {};
  EV.forEach(function (e) {
    var k = e.m + '||' + e.d;
    (EVIDX[k] = EVIDX[k] || []).push(e);
  });
  var SCENE_HINT = {
    '自媒体内容运营': '写文案、起标题、做脚本',
    'Agent与工作流': '调工具、跑多步任务',
    '代码开发': '写代码、改 bug、审代码',
    'RAG知识问答': '检索问答与摘要',
    '日常综合': '问答、写作、分析'
  };
  var SCENE_SHORT = { '自媒体内容运营': '自媒体', 'Agent与工作流': 'Agent', '代码开发': '代码', 'RAG知识问答': 'RAG', '日常综合': '日常' };
  var COLORS = ['#E23A1E', '#1B5FE0', '#0C8438'];
  var MAX_SELECT = 3, TIE = 2, LOW_COV = 0.6;
  var DIM_SHORT = { '推理与知识': '推理', '代码': '代码', '指令遵循': '指令', 'Agent与工具调用': 'Agent',
                    '长文本': '长文', '可靠性与低幻觉': '可靠', '内容创作': '写作', '图片与制图': '图片' };

  /* ── 2. 状态 ─────────────────────────────────────────────────── */
  var state = { scene: SCENES[0].name, scope: 'all', selected: [], q: '', hidePending: false,
                more: false, pendingPick: null, unlocked: true, page: null, detailModel: null };

  /* ── 3. 纯计算 ───────────────────────────────────────────────── */
  function scopeScores(m) {
    if (state.scope === 'tp' && m.scoresTp) return m.scoresTp;
    if (state.scope === 'inf' && m.scoresInf) return m.scoresInf;
    return m.scores;
  }
  function sv(m, d) {
    var v = m ? scopeScores(m)[d] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : undefined;
  }
  function has(m, d) { return sv(m, d) !== undefined; }
  function singlesOf(m) {
    if (!m) return {};
    if (state.scope === 'tp' && m.scoresTp) return m.sfTp || {};
    return m.sf || {};
  }
  function isInf(m, d) {
    if (state.scope !== 'inf' || !m.scoresInf || !(d in m.scoresInf)) return false;
    return !evsOf(m.name, d).some(function (e) { return !e.inf && e.fam && e.famN >= 2; });
  }
  function evsOf(name, d) {
    var list = EVIDX[name + '||' + d] || [];
    return state.scope === 'tp' ? list.filter(function (e) { return !e.vend && !e.inf; }) : list;
  }
  function evsDropped(name, d) { return (EVIDX[name + '||' + d] || []).length - evsOf(name, d).length; }
  function droppedCount() { return EV.reduce(function (n, e) { return n + (e.vend ? 1 : 0); }, 0); }
  function infCount() { return EV.reduce(function (n, e) { return n + (e.inf ? 1 : 0); }, 0); }
  function sceneByName(n) { return SCENES.find(function (s) { return s.name === n; }) || SCENES[0]; }
  function sceneWeights(scene) {
    var t = 0, k;
    for (k in scene.weights) t += scene.weights[k];
    var out = {};
    for (k in scene.weights) out[k] = scene.weights[k] * 100 / t;
    return out;
  }
  function W() { return sceneWeights(sceneByName(state.scene)); }
  function composite(m, scene) {
    var num = 0, den = 0, k;
    for (k in scene.weights) {
      var v = sv(m, k);
      if (typeof v === 'number') { num += scene.weights[k] * v; den += scene.weights[k]; }
    }
    return den ? num / den : 0;
  }
  function coverage(m) { return DIMS.reduce(function (n, d) { return n + (has(m, d) ? 1 : 0); }, 0); }
  function dimRank(d, m) {
    if (!has(m, d)) return null;
    var v = sv(m, d), r = 1;
    ALL.forEach(function (o) { if (has(o, d) && sv(o, d) > v) r++; });
    return r;
  }
  function sceneRank(scene, m) {
    var c = composite(m, scene), r = 1;
    ALL.forEach(function (o) {
      if (o.name !== m.name && coverage(o) > 0 && composite(o, scene) > c) r++;
    });
    return r;
  }
  var POOL = {};
  function pool(d) {
    if (!POOL[d]) {
      var v = ALL.filter(function (m) { return has(m, d); }).map(function (m) { return sv(m, d); });
      POOL[d] = v.length ? { n: v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v) }
                         : { n: 0, min: 0, max: 0 };
    }
    return POOL[d];
  }
  function poolPos(d, val) {
    var p = pool(d);
    if (!p.n || p.max === p.min) return 50;
    return clamp((val - p.min) / (p.max - p.min) * 100);
  }
  function visible() {
    var q = state.q.trim().toLowerCase();
    return ALL.filter(function (m) {
      if (state.hidePending && coverage(m) === 0) return false;
      if (!q) return true;
      return (m.name + ' ' + (m.company || '')).toLowerCase().indexOf(q) >= 0;
    });
  }
  function ranked() {
    var scene = sceneByName(state.scene);
    return visible().map(function (m) { return { m: m, c: composite(m, scene), s: sceneSigmaCached(m, scene) }; })
      .filter(function (r) { return coverage(r.m) > 0; })
      .sort(function (a, b) { return b.c - a.c; });
  }

  /* ── 3.5 置信带（2026-10-28 调研借鉴：Arena CI 判定 + 族权重延伸）─────
     σ_d = 35/√(1+m_d)，m_d = 该维各计分族 w(n)·(n−1) 之和（族取最大 n，排除推理行）；
     缺维或分数仅来自推理值 → 先验 30。σ_scene = √(Σ(Wd·σ_d)²)/ΣW（缺维按先验计）。
     ≈平判定：差距 ≤ 2×√(σa·σb)/σref，σref = 当前口径满覆盖模型 σ 的中位数——
     全支撑对沿用「差 <2 分 ≈平」语义（TIE），支撑弱则带宽按相对不确定度放宽。 */
  var SIGM = {};
  function famWeight(n) { return n < 2 ? 0 : Math.min(1, (n - 1) / 3); }
  function sigmaDim(m, d) {
    if (!has(m, d)) return null;
    var rows = evsOf(m.name, d), fams = {}, measured = 0, i, f;
    for (i = 0; i < rows.length; i++) {
      var e = rows[i];
      if (e.inf) continue;
      if (e.fam && e.famN >= 2) { measured++; fams[e.fam] = Math.max(fams[e.fam] || 0, e.famN); }
    }
    if (!measured) return 30;
    var mD = 0;
    for (f in fams) mD += famWeight(fams[f]) * (fams[f] - 1);
    return Math.max(5, Math.min(32, 35 / Math.sqrt(1 + mD)));
  }
  function sigmaScene(m, scene) {
    var w = sceneWeights(scene), tot = 0, k, acc = 0;
    for (k in w) tot += w[k];
    for (k in w) {
      var s = sigmaDim(m, k);
      if (s === null) s = 30;
      acc += (w[k] * s) * (w[k] * s);
    }
    return Math.sqrt(acc) / tot;
  }
  function sceneSigmaCached(m, scene) {
    var key = scene.name + '|' + state.scope + '|' + m.name;
    if (SIGM[key] === undefined) SIGM[key] = sigmaScene(m, scene);
    return SIGM[key];
  }
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  function sigmaRef(rowsWithS) {
    var v = rowsWithS.filter(function (r) { return coverage(r.m) === DIMS.length; })
                     .map(function (r) { return r.s; });
    return median(v) || 2.5;
  }
  function tieThreshold(sa, sb, ref) { return TIE * Math.sqrt(sa * sb) / ref; }

  /* ── 4. 关注门控（平台 API，9.51+；降级不锁）────────────────── */
  var gate = { unlocked: true, status: -9, forceLock: false };
  /* 预览开关：?lock=1 强制锁定（会话级记忆，关标签页失效）；?lock=0 显式解除。
     仅影响浏览器预览——真实容器内不会带这个参数，始终按真实关注状态门控 */
  try {
    if (new URLSearchParams(location.search).get('lock') === '1') {
      sessionStorage.setItem('xhs-preview-lock', '1');
    } else if (new URLSearchParams(location.search).get('lock') === '0') {
      sessionStorage.removeItem('xhs-preview-lock');
    }
    if (sessionStorage.getItem('xhs-preview-lock') === '1') gate.forceLock = true;
  } catch (e) { /* 存储不可用则忽略 */ }
  function clientVersionAtLeast(minVer) {
    try {
      var lo = (window.xhs && window.xhs.launchOptions) || null;
      var bv = lo && lo.miniToolEnv && Number(lo.miniToolEnv.buildVersion) || 0;
      return Math.floor(bv / 1000) >= minVer;
    } catch (e) { return false; }
  }
  function gateRefresh() {
    if (gate.forceLock) { gate.unlocked = false; gate.status = 0; renderGate(); return Promise.resolve(); }
    var mt = window.xhs && window.xhs.miniTool;
    var ok = !!(mt && typeof mt.getFollowStatus === 'function' && clientVersionAtLeast(9510));
    gate.apiOK = ok;
    if (!ok) { gate.unlocked = true; renderGate(); return Promise.resolve(); }
    return mt.getFollowStatus().then(function (r) {
      gate.status = r.follow_status;
      gate.unlocked = r.follow_status !== 0;   /* -1 查询失败不锁；2 作者本人解锁 */
      renderGate();
    }).catch(function () { gate.unlocked = true; renderGate(); });
  }
  function gateFollow() {
    var mt = window.xhs && window.xhs.miniTool;
    if (!gate.apiOK) { toast('浏览器预览：真实容器内此处拉起小红书关注面板'); return; }
    mt.followAuthor().then(function (r) {
      if (r.follow_status === 1 || r.follow_status === 2) {
        gate.unlocked = true; state.more = true;
        hideFcta(); renderGate(); renderAll();
        haptic('medium');
        toast('已关注作者，全部模型已解锁 ✦');
      }
    }).catch(function (err) {
      var code = err && err.errCode;
      if (code === 20002) toast('还没有完成关注——进阶功能保持锁定');
      else if (code === 15404) toast('今日关注引导次数已达上限');
      else if (code === 10003) toast('关注流程进行中，稍候…');
    });
  }
  function renderGate() {
    var lk = document.getElementById('inf-lk');
    var infBtn = document.querySelector('#scope button[data-s="inf"]');
    if (infBtn) {
      infBtn.classList.toggle('locked', !gate.unlocked);
      if (lk) lk.textContent = gate.unlocked ? '' : ' 🔒';
    }
    var more = document.getElementById('more');
    if (more && !state.page) {
      var n = ranked().length;
      more.textContent = (!gate.unlocked && !state.more && !state.q.trim())
        ? '🔒 关注解锁全部 ' + n + ' 个模型'
        : (state.more ? '收起' : '展开全部 ' + n + ' 个');
    }
    showFcta(!gate.unlocked);
  }
  function showFcta(on) {
    var f = document.getElementById('fcta');
    if (f) f.hidden = !on || gate.unlocked;
  }
  /* 自测句柄：mock window.xhs 后可 window.__followGate.refresh() 全流程验证 */
  window.__followGate = gate;
  gate.refresh = gateRefresh;
  gate.follow = gateFollow;
  function hideFcta() { var f = document.getElementById('fcta'); if (f) f.hidden = true; }

  /* ── 5. 工具 ─────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var fmt = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
  var clamp = function (v) { return Math.max(0, Math.min(100, v)); };
  function dimLabel(d) { return DIM_ALIAS[d] || d; }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2800);
  }

  /* 触感反馈（在线文档 vibrateShort，9.50+；能力检测，不可用即静默） */
  function haptic(type) {
    try {
      var mt = window.xhs && window.xhs.miniTool;
      if (mt && typeof mt.vibrateShort === 'function' && clientVersionAtLeast(9500))
        mt.vibrateShort({ type: type || 'light' });
    } catch (e) {}
  }

  function select(name) {
    var i = state.selected.indexOf(name);
    if (i >= 0) { state.selected.splice(i, 1); state.pendingPick = null; }
    else if (state.selected.length < MAX_SELECT) { state.selected.push(name); state.pendingPick = null; }
    else if (state.pendingPick !== name) {
      state.pendingPick = name;
      toast('已选满 3 个：再点一次「' + name + '」＝替换最早的「' + state.selected[0] + '」');
      renderCards(); return;
    } else {
      state.selected.shift();
      state.selected.push(name);
      state.pendingPick = null;
      toast('已替换：' + state.selected.join(' / '));
    }
    haptic('light');
    storeSave();
    syncHash(); renderAll();
    if (state.page === 'cmp') renderCompare();
  }

  /* ── 6. 深链 ─────────────────────────────────────────────────── */
  function syncHash() {
    var h = 'scene=' + encodeURIComponent(state.scene);
    state.selected.forEach(function (n) { h += '&model=' + encodeURIComponent(n); });
    if (state.scope !== 'all') h += '&scope=' + state.scope;
    if (state.page) h += '&page=' + state.page;
    try { history.replaceState(null, '', '#' + h); } catch (e) { location.hash = h; }
  }
  function readHash() {
    try {
      decodeURIComponent((location.hash || '').replace(/^#/, '')).split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0] === 'scene' && sceneByName(p[1]).name === p[1]) state.scene = p[1];
        else if (p[0] === 'model' && p[1] && MODEL_IX[p[1]] && state.selected.indexOf(p[1]) < 0 && state.selected.length < MAX_SELECT) state.selected.push(p[1]);
        else if (p[0] === 'scope' && ['all', 'tp', 'inf'].indexOf(p[1]) >= 0) state.scope = p[1];
        else if (p[0] === 'page' && ['cmp', 'detail', 'about'].indexOf(p[1]) >= 0) state.page = p[1];
      });
    } catch (e) {}
  }

  /* ── 7. 渲染 ─────────────────────────────────────────────────── */
  function renderChips() {
    var box = $('chips'); box.textContent = '';
    SCENES.forEach(function (s) {
      var b = el('button', s.name === state.scene ? 'on' : '', SCENE_SHORT[s.name] || s.name);
      b.title = s.name + '：' + (SCENE_HINT[s.name] || '');
      b.addEventListener('click', function () { state.scene = s.name; syncHash(); renderAll(); storeSave(); });
      box.appendChild(b);
    });
  }
  function renderScope() {
    [...$('scope').children].forEach(function (x) {
      x.className = x.getAttribute('data-s') === state.scope ? 'on' : '';
    });
  }
  function renderHero() {
    var box = $('hero'); box.textContent = '';
    var scene = sceneByName(state.scene), w = W();
    var rowsR = ranked(), refH = sigmaRef(rowsR);
    var top = rowsR.slice(0, 3);
    if (top.length) {
      var r1 = el('div', 'hero-r1');
      r1.appendChild(el('span', 'rk', '#1'));
      r1.appendChild(el('b', '', top[0].m.name));
      r1.appendChild(el('span', 's num', fmt(top[0].c)));
      r1.title = coverage(top[0].m) + '/8 维 · 点卡片看详情';
      box.appendChild(r1);
      var m0 = top[0].m;
      var picks = DIMS.filter(function (d) { return has(m0, d); })
        .sort(function (a, b) { return (w[b] || 0) - (w[a] || 0); }).slice(0, 2);
      var why = el('div', 'hero-why');
      why.innerHTML = '<b>先看 ' + m0.name + '</b>：' + picks.map(function (d) {
        return dimLabel(d) + ' 权重 ' + Math.round(w[d] || 0) + '%，排 #' + dimRank(d, m0);
      }).join('；') + '。' + (SCENE_HINT[scene.name] ? '场景＝' + SCENE_HINT[scene.name] + '。' : '');
      box.appendChild(why);
      if (coverage(m0) < 6) box.appendChild(el('div', 'hero-warn',
        '⚠ 首选仅 ' + coverage(m0) + '/8 维有证据：缺维权重已让位，名次仅供参考'));
      if ((w['内容创作'] || 0) >= 20) box.appendChild(el('div', 'hero-warn',
        '⚠ 内容创作维以英文写作为主，中文选型建议先试稿'));
      if (top.length > 1 && top[0].c - top[1].c <= tieThreshold(top[0].s, top[1].s, refH))
        box.appendChild(el('div', 'hero-warn',
          '⚠ #1 与 #2 差 ' + fmt(top[0].c - top[1].c) + ' 分，在置信带宽内（≈并列）——建议两个都试'));
      /* 权重条 */
      var bar = el('div', 'hero-bar');
      DIMS.forEach(function (d, i) {
        var s = document.createElement('i');
        s.style.width = (w[d] || 0) + '%';
        s.style.background = 'rgba(26,26,26,' + (0.72 - i * 0.062).toFixed(3) + ')';
        bar.appendChild(s);
      });
      box.appendChild(bar);
      var wl = el('div', 'hero-wl');
      DIMS.map(function (d) { return { d: d, w: w[d] || 0 }; })
        .sort(function (a, b) { return b.w - a.w; })
        .forEach(function (x, i) {
          var s = el('span', i < 3 ? '' : '');
          s.innerHTML = (i < 3 ? '<b>' + x.d + '</b>' : x.d) + ' ' + Math.round(x.w) + '%';
          wl.appendChild(s);
          wl.appendChild(document.createTextNode('　'));
        });
      box.appendChild(wl);
    }
    var blanks = ALL.length * 8 - ALL.reduce(function (s, m) { return s + coverage(m); }, 0);
    box.appendChild(el('div', 'hero-meta',
      (state.scope === 'all' ? '全部来源' : state.scope === 'tp' ? '仅第三方榜单' : '含推理补全') +
      ' 口径 · ' + scene.name + ' · ' + blanks + ' 格待定（缺数据 ≠ 0 分）'));
  }
  function renderCards() {
    var box = $('cards'); box.textContent = '';
    var rows = ranked();
    var refS = sigmaRef(rows);
    /* 并列档：锚点式分组——与组首差距 ≤ 置信阈归同组 */
    var gStart = [0], gi2;
    for (gi2 = 1; gi2 < rows.length; gi2++) {
      var anchor = rows[gStart[gStart.length - 1]];
      if (anchor.c - rows[gi2].c > tieThreshold(anchor.s, rows[gi2].s, refS)) gStart.push(gi2);
    }
    var capped = !state.q.trim();
    var show = (state.more || !capped) ? rows : rows.slice(0, 10);
    var prevStart = 0;
    show.forEach(function (r, i) {
      if (gStart.indexOf(i) > 0) {
        if (i - prevStart > 1)
          box.appendChild(el('div', 'tg', '≈ 并列 · 以上 ' + (i - prevStart) + ' 名差距在置信带宽内'));
        prevStart = i;
      }
      var m = r.m, sel = state.selected.indexOf(m.name);
      var card = el('div', 'card' + (sel >= 0 ? ' sel' : '') +
        (state.pendingPick === m.name ? ' pend' : ''));
      if (sel >= 0) card.style.setProperty('--rc', COLORS[sel % 3]);
      var ct = el('div', 'card-t');
      ct.appendChild(el('span', 'rk num', String(i + 1)));
      ct.appendChild(el('span', 'nm', m.name));
      if (m.company) ct.appendChild(el('span', 'co', m.company));
      ct.appendChild(el('span', 'val num', fmt(r.c)));
      ct.appendChild(el('span', 'un num', '±' + fmt(r.s)));
      card.appendChild(ct);
      var mini = el('div', 'card-mini');
      DIMS.forEach(function (d) {
        var i2 = document.createElement('i');
        var hasD = has(m, d);
        i2.style.height = Math.max(2, (hasD ? sv(m, d) : 3) / 100 * 15) + 'px';
        if (!hasD) i2.className = 'off';
        mini.appendChild(i2);
      });
      card.appendChild(mini);
      var wAll = W(), wCov = 0, wTot = 0;
      for (var kk in wAll) { wTot += wAll[kk]; if (has(m, kk)) wCov += wAll[kk]; }
      var covN = coverage(m), low = wTot > 0 && wCov / wTot < LOW_COV;
      var meta = el('div', 'card-meta',
        covN + '/8 维' + (low ? ' · 低覆盖' : '') +
        (Object.keys(singlesOf(m)).length ? ' · †' : '') + ' · ' + (m.company || ''));
      var info = el('button', 'card-info', '详情');
      info.addEventListener('click', function (ev) {
        ev.stopPropagation(); openPage('detail', m.name);
      });
      meta.appendChild(info);
      card.appendChild(meta);
      /* 点卡片主体 = 选中 */
      card.addEventListener('click', function () { select(m.name); });
      box.appendChild(card);
    });
    if (!rows.length) box.appendChild(el('div', 'card', '没有匹配的模型'));
    $('more').textContent = moreLabel(rows.length);
  }
  function moreLabel(n) {
    if (!gate.unlocked && !state.more && !state.q.trim()) return '🔒 关注解锁全部 ' + n + ' 个模型';
    return state.more ? '收起' : '展开全部 ' + n + ' 个';
  }
  function renderFab() {
    $('fab-n').textContent = String(state.selected.length);
    $('fab').className = state.selected.length ? '' : 'zero';
  }
  function renderAbout() {
    var box = $('about-data-body'); box.textContent = '';
    box.appendChild(el('div', 'mono',
      '数据截至 ' + (META.built || '') + ' · ' + (META.models || '') + ' · ' + (META.sources || '')));
    box.appendChild(el('div', 'mono', META.disclaimer || ''));
  }

  /* ── 对比层 ──────────────────────────────────────────────────── */
  function scopeLabel() {
    return state.scope === 'all' ? '全部来源' : state.scope === 'tp' ? '仅第三方榜单' : '含推理补全';
  }
  function renderCompare() {
    $('cmp-sub').textContent = sceneByName(state.scene).name + ' · ' + scopeLabel() + '口径';
    var body = $('cmp-body'); body.textContent = '';
    var chips = el('div', 'cmp-chips');
    state.selected.forEach(function (n, i) {
      var c = el('div', 'chip');
      var dot = el('i'); dot.style.background = COLORS[i % 3];
      c.appendChild(dot); c.appendChild(el('b', '', n));
      var x = el('span', 'x', '✕'); x.title = '移出对比';
      x.addEventListener('click', function () { select(n); });
      c.appendChild(x);
      chips.appendChild(c);
    });
    if (state.selected.length < MAX_SELECT) {
      var add = el('button', 'add', '+ 去榜单添加');
      add.addEventListener('click', function () { closePage(); });
      chips.appendChild(add);
    }
    body.appendChild(chips);
    var radarCard = el('div', 'radar-card');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 340 300');
    svg.setAttribute('aria-label', '能力雷达图');
    radarCard.appendChild(svg);
    body.appendChild(radarCard);
    var legend = el('div', 'radar-legend');
    if (!state.selected.length) legend.appendChild(el('span', '', '还没有选模型'));
    state.selected.forEach(function (n, i) {
      var it = el('span', '', n);
      var b = el('i'); b.style.background = COLORS[i % 3];
      it.insertBefore(b, it.firstChild);
      it.appendChild(el('span', '', ' ' + coverage(MODEL_IX[n]) + '/8'));
      legend.appendChild(it);
    });
    var anySf = state.selected.some(function (n) {
      var mm = MODEL_IX[n]; return mm && Object.keys(singlesOf(mm)).length;
    });
    if (anySf) legend.appendChild(el('span', 'sfx-note',
      '† = 该维只由 1 个基准族支撑（单一来源 ≠ 模型弱，点维度卡看证据）'));
    body.appendChild(legend);
    drawRadar(svg);
    var tip = el('div', 'cmp-tip',
      state.selected.length < 2 ? '选 2–3 个模型对比更直观（去榜单点卡片）' :
      '点卡片上的「详情」查看单模型 8 维明细与证据链');
    body.appendChild(tip);
    var srow = el('div', 'share-row');
    var sb = el('button', '', '生成分享卡 ⤴');
    sb.addEventListener('click', openShare);
    srow.appendChild(sb);
    body.appendChild(srow);
    DIMS.forEach(function (d) { body.appendChild(dimCard(d)); });
    body.appendChild(sceneTakeBlock());
  }
  function dimCard(d) {
    var w = W();
    var box = el('div', 'dimc');
    var d1 = el('div', 'd1');
    d1.appendChild(el('b', '', dimLabel(d)));
    if (dimSub(d)) d1.appendChild(el('span', 'w', dimSub(d)));
    d1.appendChild(el('span', 'w', '权重 ' + Math.round(w[d] || 0) + '%'));
    var hasSf = state.selected.some(function (n) { return singlesOf(MODEL_IX[n])[d]; });
    if (hasSf) d1.appendChild(el('span', 'sfb', '†'));
    box.appendChild(d1);
    var cells = el('div', 'cells');
    var refPool = [];
    ALL.forEach(function (o) { var sd = sigmaDim(o, d); if (sd !== null) refPool.push(sd); });
    var refD = median(refPool) || 5;
    var vals = state.selected.map(function (n) { return MODEL_IX[n]; })
      .filter(function (m) { return has(m, d); })
      .map(function (m) { return { m: m, n: m.name, v: sv(m, d), s: sigmaDim(m, d) }; })
      .sort(function (a, b) { return b.v - a.v; });
    var bestV = vals.length ? vals[0].v : null;
    var mg = vals.length > 1 ? vals[0].v - vals[1].v : null;
    var thD = vals.length > 1 ? tieThreshold(vals[0].s, vals[1].s, refD) : 0;
    var tie = mg !== null && mg <= thD;
    state.selected.forEach(function (n) {
      var m = MODEL_IX[n];
      var cell = el('div', 'cell');
      var isWin = vals.length > 1 && !tie && bestV !== null && has(m, d) && sv(m, d) === bestV;
      if (isWin) cell.className += ' win';
      cell.appendChild(el('div', 'cn', n));
      if (!has(m, d)) { cell.className += ' miss'; cell.appendChild(el('div', 'cv', '待定')); }
      else {
        cell.appendChild(el('div', 'cv num', fmt(sv(m, d)) + (singlesOf(m)[d] ? ' †' : '')));
        cell.appendChild(el('div', 'cu num', '±' + fmt(sigmaDim(m, d))));
        cell.appendChild(el('div', 'cr', '#' + dimRank(d, m) + '/' + pool(d).n));
      }
      cells.appendChild(cell);
    });
    box.appendChild(cells);
    if (tie) box.appendChild(el('div', 'tie',
      '≈平（差 ' + fmt(mg) + ' ≤ 置信阈 ' + fmt(thD) + '；证据支撑决定宽严）'));
    return box;
  }
  function sceneTakeBlock() {
    var box = el('div');
    if (state.selected.length < 2) return box;
    var h = el('div', 'asec');
    h.style.padding = '10px 12px';
    h.appendChild(el('h3', '', '场景取舍（差距 ≤ 置信阈 ≈平）'));
    SCENES.forEach(function (s) {
      var refS = sigmaRef(ALL.filter(function (m) { return coverage(m) > 0; })
        .map(function (m) { return { m: m, s: sceneSigmaCached(m, s) }; }));
      var vals = state.selected.map(function (n) { return MODEL_IX[n]; })
        .filter(function (m) { return coverage(m) > 0; })
        .map(function (m) { return { n: m.name, v: composite(m, s), r: sceneRank(s, m), s: sceneSigmaCached(m, s) }; })
        .sort(function (a, b) { return b.v - a.v; });
      var mg = vals.length > 1 ? vals[0].v - vals[1].v : null;
      var th = vals.length > 1 ? tieThreshold(vals[0].s, vals[1].s, refS) : 0;
      var row = el('div', 'strow' + (s.name === state.scene ? ' cur' : ''));
      row.appendChild(el('span', 'sn', SCENE_SHORT[s.name] || s.name));
      var sv2 = el('span', 'sv');
      if (!vals.length) sv2.textContent = '都没分';
      else if (vals.length === 1) sv2.textContent = '仅 ' + vals[0].n + ' 有分 #' + vals[0].r;
      else if (mg <= th) sv2.innerHTML = vals.map(function (x) { return x.n; }).join(' ≈ ')
        + '（差 ' + fmt(mg) + ' ≤ 阈 ' + fmt(th) + '）';
      else sv2.innerHTML = '<b>' + vals[0].n + '</b> 领先 +' + fmt(mg) + '（#' + vals[0].r + '）';
      row.appendChild(sv2);
      h.appendChild(row);
    });
    box.appendChild(h);
    return box;
  }
  function dimSub(d) { return (DIM_ALIAS[d] && ALIAS_FIRST) ? d : (DIM_ALIAS[d] || ''); }
  var ALIAS_FIRST = true;

  /* ── 雷达绘制 ────────────────────────────────────────────────── */
  function drawRadar(svg) {
    svg.textContent = '';
    var NS = 'http://www.w3.org/2000/svg';
    var CX = 170, CY = 145, R = 100, N = DIMS.length;
    function pt(i, r) {
      var a = (-90 + i * 360 / N) * Math.PI / 180;
      return [CX + r / 100 * R * Math.cos(a), CY + r / 100 * R * Math.sin(a)];
    }
    function add(tag, attrs, text) {
      var n = document.createElementNS(NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
      if (text !== undefined) n.textContent = text;
      return n;
    }
    [20, 40, 60, 80, 100].forEach(function (r) {
      var d = '';
      for (var i = 0; i < N; i++) d += (i ? 'L' : 'M') + pt(i, r)[0].toFixed(1) + ' ' + pt(i, r)[1].toFixed(1);
      add('path', { d: d + 'Z', fill: 'none', stroke: r === 100 ? '#B9B4A6' : '#E4E1D8',
                    'stroke-width': r === 100 ? 1.1 : 1, 'stroke-dasharray': r === 100 ? 'none' : '1.5 3.5' });
    });
    var missAny = DIMS.map(function (d) {
      return state.selected.some(function (n) { var mm = MODEL_IX[n]; return mm && !has(mm, d); });
    });
    for (var i = 0; i < N; i++) {
      var p = pt(i, 100);
      add('line', { x1: CX, y1: CY, x2: p[0], y2: p[1], stroke: '#E8E6E0', 'stroke-width': 1 });
      add('circle', missAny[i]
        ? { cx: p[0], cy: p[1], r: 3, fill: '#fff', stroke: '#B9B4A6', 'stroke-width': 1, 'stroke-dasharray': '2 2' }
        : { cx: p[0], cy: p[1], r: 1.8, fill: '#fff', stroke: '#B9B4A6', 'stroke-width': 1 });
    }
    add('circle', { cx: CX, cy: CY, r: 1.5, fill: '#B9B4A6' });
    [40, 80].forEach(function (r) {
      var y = CY - r / 100 * R;
      add('line', { x1: CX - 3, y1: y, x2: CX + 3, y2: y, stroke: '#C9C5B8', 'stroke-width': 1 });
      add('text', { x: CX + 6, y: y + 3, 'font-size': 7.5, fill: '#B0AC9E',
                    'font-family': 'ui-monospace,Consolas,monospace' }, String(r));
    });
    for (i = 0; i < N; i++) {
      var a = (-90 + i * 360 / N) * Math.PI / 180;
      var lx = CX + (R + 20) * Math.cos(a), ly = CY + (R + 20) * Math.sin(a) + 3;
      var anchor = Math.abs(Math.cos(a)) < 0.35 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      var tg = document.createElementNS(NS, 'g');
      tg.setAttribute('data-dim', DIMS[i]);
      tg.style.cursor = 'pointer';
      var tt = document.createElementNS(NS, 'text');
      tt.setAttribute('x', lx); tt.setAttribute('y', ly); tt.setAttribute('text-anchor', anchor);
      tt.setAttribute('font-size', 10.5); tt.setAttribute('font-weight', 600); tt.setAttribute('fill', '#1A1A1A');
      tt.appendChild(document.createTextNode(dimLabel(DIMS[i])));
      var sfx = '';
      state.selected.forEach(function (n) {
        var mm = MODEL_IX[n];
        if (mm && singlesOf(mm)[DIMS[i]]) sfx = mm.name;
      });
      if (sfx) {
        var t3 = document.createElementNS(NS, 'tspan');
        t3.setAttribute('dx', 2); t3.setAttribute('fill', '#E23A1E'); t3.textContent = '†';
        tt.appendChild(t3);
        var ttl = document.createElementNS(NS, 'title');
        ttl.textContent = '† ' + sfx + ' 在这一维只有 1 个基准族支撑';
        tg.appendChild(ttl);
      }
      tg.appendChild(tt);
      svg.appendChild(tg);
      var hit = add('line', { x1: CX, y1: CY, x2: pt(i, 100)[0], y2: pt(i, 100)[1],
                              stroke: 'transparent', 'stroke-width': 12, style: 'cursor:pointer' });
      hit.setAttribute('data-dim', DIMS[i]);
    }
    state.selected.forEach(function (name) {
      var m = MODEL_IX[name]; if (!m) return;
      var idx = state.selected.indexOf(name);
      var c = COLORS[idx % 3];
      var vs = DIMS.map(function (d) { return has(m, d) ? clamp(sv(m, d)) : null; });
      var runs = [], cur = null, start = 0;
      if (vs.some(function (v) { return v === null; })) { while (vs[start] !== null) start++; }
      for (var i2 = 0; i2 < N; i2++) {
        var k = (start + i2) % N;
        if (vs[k] === null) { cur = null; }
        else { if (!cur) { cur = []; runs.push(cur); } cur.push(k); }
      }
      runs.forEach(function (run) {
        if (run.length === 1) {
          var p1 = pt(run[0], vs[run[0]]);
          add('circle', { cx: p1[0], cy: p1[1], r: 2.6, fill: c, stroke: '#fff', 'stroke-width': 1 });
          return;
        }
        var d = '';
        run.forEach(function (kk, j) {
          var pp = pt(kk, vs[kk]);
          d += (j ? 'L' : 'M') + pp[0].toFixed(1) + ' ' + pp[1].toFixed(1);
        });
        var full = run.length === N;
        if (full) d += 'Z';
        add('path', { d: d, fill: full ? c : 'none', 'fill-opacity': full && idx === 0 ? .12 : 0,
                      stroke: c, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        run.forEach(function (kk) {
          var pv = pt(kk, vs[kk]);
          add('circle', { cx: pv[0], cy: pv[1], r: 2.6, fill: c, stroke: '#fff', 'stroke-width': 1 });
        });
      });
      DIMS.forEach(function (d, i3) {
        if (!isInf(m, d)) return;
        var pc = pt(i3, vs[i3] !== null ? vs[i3] : 0);
        add('circle', { cx: pc[0], cy: pc[1], r: 3.2, fill: '#fff', stroke: c,
                        'stroke-width': 1.4, 'stroke-dasharray': '2 2' });
      });
    });
  }

  /* ── 模型详情层 ──────────────────────────────────────────────── */
  function renderDetail(name) {
    var m = MODEL_IX[name]; if (!m) return;
    var scene = sceneByName(state.scene);
    $('det-name').textContent = m.name;
    $('det-sub').textContent = (m.company || '') +
      (m.open === true ? ' · 开源' : m.open === false ? ' · 闭源' : ' · 开源未确认') +
      ' · ' + scene.name + '综合 ' + fmt(composite(m, scene)) + ' ±' + fmt(sceneSigmaCached(m, scene)) +
      ' · ' + coverage(m) + '/8 维';
    var body = $('det-body'); body.textContent = '';
    if (m.note) {
      var nt = el('div', 'det-note'); nt.appendChild(el('b', '', '备注 ')); nt.appendChild(document.createTextNode(m.note));
      body.appendChild(nt);
    }
    var d8 = el('div', 'd8');
    DIMS.forEach(function (d) {
      var row = el('div', 'r' + (has(m, d) ? '' : ' miss') + (isInf(m, d) ? ' inf' : ''));
      row.appendChild(el('span', 'l', dimLabel(d)));
      var b = el('span', 'b');
      if (has(m, d)) {
        var fi = document.createElement('i');
        fi.style.width = clamp(poolPos(d, sv(m, d))) + '%';
        b.appendChild(fi);
      }
      row.appendChild(b);
      var v = el('span', 'v');
      if (!has(m, d)) v.textContent = '待定';
      else v.innerHTML = fmt(sv(m, d)) + (singlesOf(m)[d] ? ' †' : '') +
        ' <span class="un">±' + fmt(sigmaDim(m, d)) + '</span>' +
        ' <span class="rank">#' + dimRank(d, m) + '</span>';
      row.appendChild(v);
      d8.appendChild(row);
      if (m && has(m, d)) {
        var xv = el('span', 'xv', '证据 ▾');
        xv.addEventListener('click', function () {
          var list = row.nextElementSibling;
          list.hidden = !list.hidden;
          xv.textContent = list.hidden ? '证据 ▾' : '收起 ▴';
        });
        row.appendChild(xv);
        var evs = el('div', 'evs'); evs.hidden = true;
        evsOf(m.name, d).forEach(function (e) {
          var evb = el('div', 'ev' + (e.inf ? ' inf' : ''));
          var r1 = el('div', 'r1');
          r1.appendChild(el('span', 'src', e.src));
          r1.appendChild(el('span', 'val', e.val === null ? '—' : fmt(e.val)));
          evb.appendChild(r1);
          evb.appendChild(el('div', 'cat', e.cat));
          evb.appendChild(el('div', 'meta', '原始 ' + e.raw + '（' + e.scale + '）@' + e.date +
            (e.fam ? ' · 族 ' + e.fam + '（n=' + e.famN + (e.famN >= 2 ? '，权重×' + gateWeight(e.famN) : '，不计分') + '）' : '') +
            (e.inf && e.basis ? ' · ' + e.basis : '') +
            (e.inf && e.loeoMAE ? ' · MAE ' + e.loeoMAE : '') +
            (e.url ? ' · ' + e.url : '')));
          evs.appendChild(evb);
        });
        if (!evsOf(m.name, d).length) evs.appendChild(el('div', 'ev', el('div', 'cat', '无可用证据 → 待定')));
        else if (evsOf(m.name, d).length > 1)
          evs.appendChild(el('div', 'evnote',
            '同基准多来源并列展示，便于对照；计分时同一基准族只取一票（第三方优先、日期新优先）。'));
        row.insertAdjacentElement('afterend', evs);
      }
    });
    body.appendChild(d8);
    var sec = el('div', 'det-sec');
    sec.appendChild(el('h3', '', '本场景排名'));
    ranked().slice(0, 20).forEach(function (r2, i) {
      var row = el('div', 'dist');
      row.title = '置信带 ±' + fmt(r2.s) + '（证据支撑越弱带越宽）';
      row.appendChild(el('span', 'nm', '#' + (i + 1) + ' ' + r2.m.name));
      var b = el('span', 'b');
      var fi = document.createElement('i');
      fi.style.width = clamp(r2.c) + '%';
      b.appendChild(fi); row.appendChild(b);
      row.appendChild(el('span', 'v num', fmt(r2.c)));
      sec.appendChild(row);
    });
    body.appendChild(sec);
  }
  function gateWeight(n) {
    if (n < 2) return 0;
    return Math.round(Math.min(1, (n - 1) / 3) * 100) / 100;
  }

  /* ── 6.5 本地记忆（在线文档 setStorage/getStorage，9.46+；低版本 localStorage 降级）──
     读写失败必须容忍：持久化不保证，降级路径静默。 */
  var SKEY = 'radar-state-v1';
  function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function storeSave() {
    var payload = { scene: state.scene, scope: state.scope,
                    selected: state.selected.slice(0, MAX_SELECT), hidePending: !!state.hidePending };
    var s;
    try { s = JSON.stringify(payload); } catch (e) { return; }
    var mt = window.xhs && window.xhs.miniTool;
    if (mt && typeof mt.setStorage === 'function' && clientVersionAtLeast(9460)) {
      mt.setStorage({ key: SKEY, data: s }).catch(function () {});
      return;
    }
    try { localStorage.setItem(SKEY, s); } catch (e) {}
  }
  function storeLoad(cb) {
    var mt = window.xhs && window.xhs.miniTool;
    if (mt && typeof mt.getStorage === 'function' && clientVersionAtLeast(9460)) {
      mt.getStorage({ key: SKEY }).then(function (r) { cb(safeParse(r.data)); })
        .catch(function () { cb(null); });
      return;
    }
    var raw = null;
    try { raw = localStorage.getItem(SKEY); } catch (e) {}
    cb(safeParse(raw));
  }

  /* ── 6.6 分享卡（Canvas 2D → writeTempFile → postNote / saveImageToPhotosAlbum）
     在线文档：postNote title≤20 字、content≤1000 字，成功回调只代表发布页唤起；
     saveImageToPhotosAlbum 须用户手势触发；大图先 writeTempFile 落盘。 */
  function rrPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  /* ═══ 分享卡 v4「深空霓虹」——深色渐变 + 玻璃卡片 + 发光雷达。与旧版零继承。 ═══ */
  /* ★ 作者署名配置：填昵称/小红书号即显示在卡底（留空则不显示）；头像 author.png 放 xhs_template/ 重跑构建 */
  var AUTHOR = { name: '', xhsId: '', avatar: 'author.png' };
  var authorImg = null;
  (function () {
    var im = new Image();
    im.onload = function () { authorImg = im; };
    im.src = AUTHOR.avatar;
  })();
  /* 分享卡书面维度短名 */
  var CARD_DIM = { '推理与知识': '推理', '代码': '代码', '指令遵循': '指令遵循', 'Agent与工具调用': 'Agent',
                   '长文本': '长文本', '可靠性与低幻觉': '可靠性', '内容创作': '内容创作', '图片与制图': '图片制图' };
  function drawShareCard() {
    var W = 1080, H = 1440, M = 64;
    var SANS = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    var MONO = 'ui-monospace,Menlo,Consolas,"Courier New",monospace';
    var COLS = ['#FF6B4A', '#4D8DFF', '#3DDC84'];
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    function fit(t, font, maxW) {
      ctx.font = font;
      if (ctx.measureText(t).width <= maxW) return t;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      return t + '…';
    }
    function glass(x, y, w, h, r) {
      ctx.fillStyle = 'rgba(255,255,255,0.055)';
      rrPath(ctx, x, y, w, h, r); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1.5;
      rrPath(ctx, x, y, w, h, r); ctx.stroke();
    }

    /* 深空背景 + 双色氛围光 */
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#171A30'); bg.addColorStop(1, '#0B0C16');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var blob = ctx.createRadialGradient(880, 150, 0, 880, 150, 500);
    blob.addColorStop(0, 'rgba(255,90,60,0.20)'); blob.addColorStop(1, 'rgba(255,90,60,0)');
    ctx.fillStyle = blob; ctx.fillRect(0, 0, W, H);
    blob = ctx.createRadialGradient(150, 1200, 0, 150, 1200, 540);
    blob.addColorStop(0, 'rgba(77,141,255,0.17)'); blob.addColorStop(1, 'rgba(77,141,255,0)');
    ctx.fillStyle = blob; ctx.fillRect(0, 0, W, H);

    /* 顶栏：品牌玻璃片 + 日期 */
    glass(M, 64, 286, 68, 34);
    ctx.beginPath(); ctx.arc(M + 38, 98, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#FF6B4A'; ctx.shadowColor = '#FF6B4A'; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = '800 30px ' + SANS; ctx.textAlign = 'left';
    ctx.fillText('模型雷达', M + 62, 110);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '500 22px ' + MONO;
    ctx.fillText(String(META.built || '').slice(0, 10), W - M, 108);
    ctx.textAlign = 'left';

    /* 场景大标题 */
    var scene = sceneByName(state.scene);
    var sel = state.selected.map(function (n) { return MODEL_IX[n]; }).filter(Boolean);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '600 24px ' + SANS;
    ctx.fillText(sel.length ? '我的选型 · 当前场景' : '当前场景 · TOP 3', M, 250);
    ctx.fillStyle = '#fff'; ctx.font = '900 92px ' + SANS;
    ctx.fillText(fit(scene.name, '900 92px ' + SANS, W - 2 * M), M, 356);
    var ubar = ctx.createLinearGradient(M, 0, M + 190, 0);
    ubar.addColorStop(0, '#FF6B4A'); ubar.addColorStop(1, '#FFC24A');
    ctx.fillStyle = ubar; rrPath(ctx, M, 384, 190, 10, 5); ctx.fill();

    /* 霓虹雷达 */
    var N = DIMS.length, R = 224, CX = W / 2, CY = 655;
    [25, 50, 75, 100].forEach(function (r) {
      ctx.beginPath();
      for (var i = 0; i < N; i++) {
        var a = (-90 + i * 360 / N) * Math.PI / 180;
        var px = CX + r / 100 * R * Math.cos(a), py = CY + r / 100 * R * Math.sin(a);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = r === 100 ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = r === 100 ? 2 : 1.5;
      ctx.setLineDash(r === 100 ? [] : [4, 9]);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    for (var i = 0; i < N; i++) {
      var ang = (-90 + i * 360 / N) * Math.PI / 180;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(CX, CY);
      ctx.lineTo(CX + R * Math.cos(ang), CY + R * Math.sin(ang)); ctx.stroke();
      var lx = CX + (R + 44) * Math.cos(ang), ly = CY + (R + 44) * Math.sin(ang);
      ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = '600 27px ' + SANS;
      ctx.textAlign = Math.abs(Math.cos(ang)) < 0.35 ? 'center' : (Math.cos(ang) > 0 ? 'left' : 'right');
      ctx.fillText(CARD_DIM[DIMS[i]] || DIMS[i], lx, ly + 9);
    }
    ctx.textAlign = 'left';
    sel.forEach(function (m, idx) {
      var col = COLS[idx % 3];
      var vs = DIMS.map(function (d) { return has(m, d) ? clamp(sv(m, d)) : null; });
      var runs = [], cur = null, start = 0;
      if (vs.some(function (v) { return v === null; })) { while (vs[start] !== null) start++; }
      for (var k = 0; k < N; k++) {
        var kk = (start + k) % N;
        if (vs[kk] === null) cur = null;
        else { if (!cur) { cur = []; runs.push(cur); } cur.push(kk); }
      }
      runs.forEach(function (run) {
        ctx.beginPath();
        run.forEach(function (r2, j) {
          var a2 = (-90 + r2 * 360 / N) * Math.PI / 180;
          var px = CX + vs[r2] / 100 * R * Math.cos(a2), py = CY + vs[r2] / 100 * R * Math.sin(a2);
          if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        if (run.length === N) ctx.closePath();
        ctx.shadowColor = col; ctx.shadowBlur = 10;
        ctx.strokeStyle = col; ctx.lineWidth = 6;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (run.length === N && idx === 0) { ctx.fillStyle = col; ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.stroke();
        ctx.shadowBlur = 0;
        run.forEach(function (r2) {
          var a2 = (-90 + r2 * 360 / N) * Math.PI / 180;
          ctx.beginPath();
          ctx.arc(CX + vs[r2] / 100 * R * Math.cos(a2), CY + vs[r2] / 100 * R * Math.sin(a2), 7, 0, Math.PI * 2);
          ctx.fillStyle = col; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5; ctx.stroke();
        });
      });
    });

    /* 玻璃卡排行（选中的模型 / 未选则 Top3） */
    var rows = sel.length
      ? sel.map(function (m, i) { return { m: m, c: composite(m, scene), s: sceneSigmaCached(m, scene) }; })
      : ranked().slice(0, 3).map(function (r) { return { m: r.m, c: r.c, s: r.s }; });
    var cy0 = 956, ch = 104, gap = 14;
    rows.forEach(function (r, i) {
      var col = COLS[i % 3];
      glass(M, cy0, W - 2 * M, ch, 22);
      var pg = ctx.createLinearGradient(M + 20, cy0, M + 80, cy0 + ch);
      if (i === 0) { pg.addColorStop(0, '#FF6B4A'); pg.addColorStop(1, '#FFC24A'); }
      else { pg.addColorStop(0, 'rgba(255,255,255,0.16)'); pg.addColorStop(1, 'rgba(255,255,255,0.05)'); }
      ctx.fillStyle = pg; rrPath(ctx, M + 22, cy0 + (ch - 56) / 2, 56, 56, 18); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 25px ' + SANS; ctx.textAlign = 'center';
      ctx.fillText('#' + (i + 1), M + 50, cy0 + ch / 2 + 9);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff'; ctx.font = '700 37px ' + SANS;
      ctx.fillText(fit(r.m.name, '700 37px ' + SANS, 450), M + 102, cy0 + 48);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '500 21px ' + MONO;
      ctx.fillText('±' + fmt(r.s) + ' · ' + coverage(r.m) + '/8', M + 104, cy0 + 84);
      ctx.textAlign = 'right';
      ctx.font = '800 56px ' + SANS;
      ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.fillStyle = col;
      ctx.fillText(fmt(r.c), W - M - 28, cy0 + 68);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      cy0 += ch + gap;
    });

    /* 底部：署名 + 口径 */
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(M, 1338, W - 2 * M, 1.5);
    ctx.textAlign = 'center';
    if (AUTHOR.name || AUTHOR.xhsId) {
      var sig = (AUTHOR.name ? '@' + AUTHOR.name : '') +
                (AUTHOR.xhsId ? (AUTHOR.name ? ' · ' : '') + '小红书号 ' + AUTHOR.xhsId : '');
      ctx.font = '700 30px ' + SANS;
      var tw = ctx.measureText(sig).width;
      var avD = authorImg ? 50 : 0, gap2 = authorImg ? 16 : 0;
      var gx = W / 2 - (avD + gap2 + tw) / 2;
      if (authorImg) {
        ctx.save();
        ctx.beginPath(); ctx.arc(gx + avD / 2, 1372, avD / 2, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(authorImg, gx, 1347, avD, avD);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(gx + avD / 2, 1372, avD / 2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = '700 30px ' + SANS;
      ctx.fillText(sig, gx + avD + gap2 + tw / 2, 1382);
      ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = '400 20px ' + MONO;
      ctx.fillText('RANK-IN-POOL · 缺数据 ≠ 0 · MODEL RADAR', W / 2, 1416);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = '400 20px ' + MONO;
      ctx.fillText('RANK-IN-POOL · 缺数据 ≠ 0 · VOL.' + String(META.built || '').slice(0, 10) + ' · MODEL RADAR', W / 2, 1392);
    }
    ctx.textAlign = 'left';
    return c;
  }
  function shareText() {
    var scene = sceneByName(state.scene);
    var names = state.selected.length
      ? state.selected.join('、')
      : ranked().slice(0, 3).map(function (r) { return r.m.name; }).join('、');
    return '【' + scene.name + '】我的选型：' + names + '。分数为「基准族内位次分」（约等于赢过池内对手的比例），聚合自公开榜单。用「模型雷达」小工具，按场景选模型。';
  }
  var sheetEls = null;
  function miniToolOk(name) {
    var mt = window.xhs && window.xhs.miniTool;
    return !!(mt && typeof mt[name] === 'function');
  }
  function buildSheet() {
    var scrim = el('div', 'sheet-scrim');
    var sh = el('div', 'sheet');
    var h = el('div', 'sheet-h');
    h.appendChild(el('b', '', '分享卡'));
    var x = el('button', '', '✕');
    x.setAttribute('aria-label', '关闭');
    x.addEventListener('click', closeShare);
    h.appendChild(x);
    sh.appendChild(h);
    var img = el('img', 'sheet-img');
    img.alt = '分享卡预览';
    sh.appendChild(img);
    var btns = el('div', 'sheet-btns');
    var bp = el('button', 'primary', '发笔记');
    var bs = el('button', 'ghost', '保存到相册');
    btns.appendChild(bp); btns.appendChild(bs);
    sh.appendChild(btns);
    sh.appendChild(el('div', 'sheet-hint',
      '「发笔记」打开小红书发布页，正文已带选型结论；「保存到相册」直接存图。未选模型时默认生成 Top 3 卡。'));
    scrim.addEventListener('click', closeShare);
    bp.addEventListener('click', doPostNote);
    bs.addEventListener('click', doSaveAlbum);
    document.body.appendChild(scrim);
    document.body.appendChild(sh);
    sheetEls = { scrim: scrim, sh: sh, img: img, bp: bp, bs: bs, busy: false };
  }
  function openShare() {
    if (!sheetEls) buildSheet();
    sheetEls.img.src = drawShareCard().toDataURL('image/png');
    sheetEls.scrim.classList.add('on');
    sheetEls.sh.classList.add('on');
    haptic('light');
  }
  function closeShare() {
    if (!sheetEls) return;
    sheetEls.scrim.classList.remove('on');
    sheetEls.sh.classList.remove('on');
  }
  function doPostNote() {
    haptic('light');
    if (!miniToolOk('postNote')) { toast('浏览器预览：真实容器内此处唤起小红书发布页'); return; }
    if (sheetEls.busy) return;
    sheetEls.busy = true;
    var mt = window.xhs.miniTool;
    var data = sheetEls.img.src;
    var fin = function (err) {
      sheetEls.busy = false;
      if (err) toast('唤起发布页失败' + (err && err.errCode ? '（' + err.errCode + '）' : ''));
      else toast('发布页已唤起——记得点「发布」哦');
    };
    var go = function (url) {
      mt.postNote({ title: '模型雷达 · 我的选型', content: shareText(),
                    pageType: 'photo_publish',
                    mediaInfo: { image_resources: [{ url: url }] } })
        .then(function () { fin(null); }).catch(fin);
    };
    if (miniToolOk('writeTempFile'))
      mt.writeTempFile({ data: data }).then(function (r) { go(r.filePath); }).catch(function () { go(data); });
    else go(data);
  }
  function doSaveAlbum() {
    haptic('light');
    if (!miniToolOk('saveImageToPhotosAlbum')) { toast('浏览器预览：真实容器内此处保存到相册'); return; }
    if (sheetEls.busy) return;
    sheetEls.busy = true;
    var mt = window.xhs.miniTool;
    var data = sheetEls.img.src;
    var fin = function (err) {
      sheetEls.busy = false;
      if (err) toast('保存失败' + (err && err.errCode ? '（' + err.errCode + '）' : ''));
      else { haptic('medium'); toast('已保存到相册 ✓'); }
    };
    var save = function (p) { mt.saveImageToPhotosAlbum({ filePath: p }).then(function () { fin(null); }).catch(fin); };
    if (miniToolOk('writeTempFile'))
      mt.writeTempFile({ data: data }).then(function (r) { save(r.filePath); }).catch(function () { save(data); });
    else save(data);
  }

  /* ── 页面（层）管理 ──────────────────────────────────────────── */
  function openPage(kind, arg) {
    closePage();
    if (kind === 'cmp') { renderCompare(); $('pg-cmp').classList.add('on'); }
    else if (kind === 'detail') { renderDetail(arg); $('det-name').textContent = arg; $('pg-det').classList.add('on'); }
    else if (kind === 'about') { renderAbout(); $('pg-about').classList.add('on'); }
    state.page = kind;
    syncHash();
    document.body.style.overflow = 'hidden';
  }
  function closePage() {
    ['pg-cmp', 'pg-det', 'pg-about'].forEach(function (id) {
      $(id).classList.remove('on');
    });
    if (state.page) { state.page = null; document.body.style.overflow = ''; syncHash(); }
  }

  /* ── 8. 事件 ─────────────────────────────────────────────────── */
  /* ── 容器顶部避让（在线文档 §3.11 getWindowInfo，9.49+）─────────────
     容器全屏渲染：状态栏 + 导航按钮（back/me/share）浮在页面顶部。
     向容器要真实高度：--top-inset = max(状态栏, 导航按钮底部) + 10px 余量。
     API 不可用（浏览器/老客户端）时不动，回落到 CSS 基线 28px。 */
  (function () {
    var mt = window.xhs && window.xhs.miniTool;
    if (!mt || typeof mt.getWindowInfo !== 'function') return;
    mt.getWindowInfo().then(function (r) {
      var top = (r.statusBarHeight || 0) + 10;
      var mb = r.menuButtons && r.menuButtons.back;
      if (mb && typeof mb.bottom === 'number') top = Math.max(top, mb.bottom + 10);
      if (r.safeArea && typeof r.safeArea.top === 'number') top = Math.max(top, r.safeArea.top + 10);
      document.documentElement.style.setProperty('--top-inset', top.toFixed(0) + 'px');
    }).catch(function () {});
  })();

  $('scope').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var s = b.getAttribute('data-s');
    if (s === 'inf' && !gate.unlocked) { showFcta(true); toast('「含推理补全」为关注解锁功能'); return; }
    state.scope = s; POOL = {}; SIGM = {}; syncHash(); renderAll(); storeSave();
  });
  $('about-open').addEventListener('click', function () { openPage('about'); });
  $('about-back').addEventListener('click', closePage);
  $('cmp-back').addEventListener('click', closePage);
  $('det-back').addEventListener('click', closePage);
  $('fab').addEventListener('click', function () {
    if (!state.selected.length) { toast('先在榜单点卡片选模型，再对比'); return; }
    openPage('cmp');
  });
  $('q').addEventListener('input', function (ev) {
    state.q = ev.target.value; $('q-clear').hidden = !state.q;
    renderCards();
  });
  $('q-clear').addEventListener('click', function () {
    $('q').value = ''; state.q = ''; $('q-clear').hidden = true;
    renderCards();
  });
  $('hide-pending').addEventListener('change', function () {
    state.hidePending = this.checked; renderCards(); storeSave();
  });
  $('more').addEventListener('click', function () {
    if (!gate.unlocked && !state.more && !state.q.trim()) { showFcta(true); toast('关注作者解锁全部模型'); return; }
    state.more = !state.more; renderCards(); renderGate();
  });
  $('fcta-go').addEventListener('click', gateFollow);
  $('fcta-x').addEventListener('click', hideFcta);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closePage(); });

  /* ── 9. 深链 + 启动 ──────────────────────────────────────────── */
  function renderAll() {
    renderChips(); renderScope(); renderHero(); renderCards(); renderGate(); renderFab(); renderAbout();
    $('hd-sub').textContent = META.built + ' · ' + DIMS.length + ' 维 · ' + ALL.length + ' 模型';
  }
  readHash();
  /* 深链优先，本地记忆补缺（异步恢复，回读后重渲染一次） */
  var hashRaw = location.hash || '';
  storeLoad(function (saved) {
    if (!saved) return;
    var changed = false;
    if (hashRaw.indexOf('scene=') < 0 && saved.scene &&
        sceneByName(saved.scene).name === saved.scene && saved.scene !== state.scene) {
      state.scene = saved.scene; changed = true;
    }
    if (hashRaw.indexOf('scope=') < 0 && (saved.scope === 'all' || saved.scope === 'tp') &&
        saved.scope !== state.scope) {
      state.scope = saved.scope; POOL = {}; SIGM = {}; changed = true;
    }
    if (hashRaw.indexOf('model=') < 0 && Object.prototype.toString.call(saved.selected) === '[object Array]' &&
        saved.selected.length) {
      var add = saved.selected.filter(function (n) {
        return MODEL_IX[n] && state.selected.indexOf(n) < 0;
      }).slice(0, MAX_SELECT - state.selected.length);
      if (add.length) { state.selected = state.selected.concat(add); changed = true; }
    }
    if (typeof saved.hidePending === 'boolean' && saved.hidePending !== state.hidePending) {
      state.hidePending = saved.hidePending;
      var hp = $('hide-pending');
      if (hp) hp.checked = saved.hidePending;
      changed = true;
    }
    if (changed) { renderAll(); renderFab(); }
  });
  renderAll();
  renderFab();
  gateRefresh();
  if (state.page === 'cmp') openPage('cmp');
  else if (state.page === 'about') openPage('about');
})();
