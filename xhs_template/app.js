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
  var gate = { unlocked: true, status: -9, forceLock: false, apiOK: false, apiState: 'init', buildVersion: 0, busy: false };
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
  function readBV(lo) {
    var e = lo && lo.miniToolEnv;
    return Number(e && e.buildVersion) || 0;
  }
  function gateRefresh() {
    if (gate.forceLock) { gate.unlocked = false; gate.status = 0; gate.apiState = 'preview-lock'; renderGate(); return Promise.resolve(); }
    var mt = window.xhs && window.xhs.miniTool;
    var hasApi = !!(mt && typeof mt.getFollowStatus === 'function');
    if (!hasApi) {
      gate.apiOK = false; gate.unlocked = true; gate.apiState = 'no-api';
      renderGate(); return Promise.resolve();
    }
    /* 文档 §3.6：launchOptions / miniToolEnv / buildVersion 都可能缺失，
       同步值不存在时必须回退异步 mt.getLaunchOptions()——只读同步路径会把
       新版容器误判成旧版，导致门控整体失效（2026-10-31 真机问题根因）。 */
    var bv = readBV(window.xhs && window.xhs.launchOptions);
    var p = (bv || typeof mt.getLaunchOptions !== 'function')
      ? Promise.resolve(bv)
      : mt.getLaunchOptions().then(function (lo) { return readBV(lo); }).catch(function () { return 0; });
    return p.then(function (v) {
      gate.buildVersion = v;
      gate.apiOK = Math.floor(v / 1000) >= 9510;
      gate.apiState = gate.apiOK ? 'ok' : 'old-client(' + v + ')';
      if (!gate.apiOK) { gate.unlocked = true; renderGate(); return; }
      return mt.getFollowStatus().then(function (r) {
        gate.status = r.follow_status;
        gate.unlocked = r.follow_status !== 0;   /* -1 查询失败不锁；2 作者本人解锁 */
        gate.apiState = 'ok:f' + r.follow_status;
        renderGate();
      }).catch(function () { gate.unlocked = true; gate.apiState = 'query-fail'; renderGate(); });
    });
  }
  function gateFollow() {
    var mt = window.xhs && window.xhs.miniTool;
    /* 实时探测而非缓存 apiOK——预览注入 mock 或启动时序差都不会误走预览分支 */
    if (!mt || typeof mt.followAuthor !== 'function') { toast('浏览器预览：真实容器内此处拉起小红书关注面板'); return; }
    if (gate.busy) return;
    gate.busy = true;
    var done = function () { gate.busy = false; };
    mt.followAuthor().then(function (r) {
      var st = r && r.follow_status;
      if (st === 1 || st === 2) return { follow_status: st };
      /* 文档 §3.15：followAuthor 执行失败也 resolve（follow_status=-1），不走 reject——
         返回值不是明确的 1/2 时一律用 getFollowStatus 复查，杜绝静默无反馈 */
      return mt.getFollowStatus();
    }).then(function (r) {
      done();
      var st = r && r.follow_status;
      if (st === 1 || st === 2) {
        gate.unlocked = true; state.more = true;
        hideFcta(); renderGate(); renderAll();
        haptic('medium');
        toast('已关注作者，全部模型已解锁 ✦');
      } else if (st === -1) {
        gate.unlocked = true; renderGate();   /* 查询失败不锁——与 gateRefresh 同一降级口径 */
        toast('关注状态查询失败，已临时解锁');
      } else {
        toast('还没有完成关注——进阶功能保持锁定');
      }
    }).catch(function (err) {
      done();
      var code = err && err.errCode;
      if (code === 20002) toast('还没有完成关注——进阶功能保持锁定');
      else if (code === 15404) toast('今日关注引导次数已达上限');
      else if (code === 10003) toast('关注流程进行中，稍候…');
    });
  }
  function renderGate() {
    var fsub = document.getElementById('fcta-sub');
    if (fsub) fsub.textContent = '全部 ' + ranked().length + ' 个模型 · 前 10 名永久免费';
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
        ? '🔒 蹲更新 · 解锁全部 ' + n + ' 个模型'
        : (state.more ? '收起' : '展开全部 ' + n + ' 个');
    }
    var sb = document.getElementById('share-btn');
    if (sb) sb.textContent = gate.unlocked ? '生成分享卡 ⤴' : '🔒 蹲更新后可生成分享卡';
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
      if (mt && typeof mt.vibrateShort === 'function')
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
    if (!gate.unlocked && !state.more && !state.q.trim()) return '🔒 蹲更新 · 解锁全部 ' + n + ' 个模型';
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
    var sb = el('button', 'share-cta', gate.unlocked ? '生成分享卡 ⤴' : '🔒 蹲更新后可生成分享卡');
    sb.id = 'share-btn';
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
    if (mt && typeof mt.setStorage === 'function') {
      mt.setStorage({ key: SKEY, data: s }).catch(function () {});
      return;
    }
    try { localStorage.setItem(SKEY, s); } catch (e) {}
  }
  function storeLoad(cb) {
    var mt = window.xhs && window.xhs.miniTool;
    if (mt && typeof mt.getStorage === 'function') {
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
  /* ═══ 分享图集 v9——1200×1600 高清套装（用户定调）：
         主卡 = 模型对比卡（墨色刊头带 + 五场景名次对比条 + 雷达叠加 + 双列名次清单 + 结论行）；
         副卡 = 每个选中模型的能力档案卡（大字模型名 + 五场景名次 + 雷达/清单 + 强项与待加强 + 二维码）。
         输出三通道：发笔记（多图，最多 18 张）/ 发评论晒卡（interactionOpenApi 9.49+，容器会关闭小工具拉起评论，
         miniToolSnapshotInfo 携带对比状态供评论区重开恢复——引流闭环）/ 保存到相册（循环多张）。
         原创刊物语言：墨带 + 米白纸 + 双线框 + 朱红名次；数字一律黑体。与 v3–v8 零继承。 ═══ */
  /* ★ 作者署名配置：填昵称/小红书号即显示在卡底（留空则不显示）；头像 author.png 放 xhs_template/ 重跑构建 */
  var AUTHOR = { name: '赛博摆渡人', xhsId: '49224513797', avatar: 'author.png' };
  var authorImg = null;
  (function () { var im = new Image(); im.onload = function () { authorImg = im; }; im.src = AUTHOR.avatar; })();
  var CARD_DIM = { '推理与知识': '推理与知识', '代码': '代码', '指令遵循': '指令遵循', 'Agent与工具调用': '智能体',
                   '长文本': '长文本', '可靠性与低幻觉': '可靠性', '内容创作': '内容创作', '图片与制图': '图片与制图' };
  var CARD_DIM_MINI = { '推理与知识': '推理', '代码': '代码', '指令遵循': '指令', 'Agent与工具调用': '智能',
                        '长文本': '长文', '可靠性与低幻觉': '可靠', '内容创作': '内容', '图片与制图': '图片' };
  /* 小红书二维码：矩阵由 python qrcode 库预生成，Canvas 自绘圆点风格（不贴截图、不引第三方 JS）。
     当前载荷＝小红书号文本（cv2 回读验证可扫）；待用户重发「分享主页」二维码截图后解码替换为主页短链（扫码直跳）。 */
  var XHS_QR = { payload: '小红书号：49224513797', n: 25, rows: [
    '1111111000001100101111111',
    '1000001010111100101000001',
    '1011101011010001001011101',
    '1011101010100111001011101',
    '1011101000100010001011101',
    '1000001001101100001000001',
    '1111111010101010101111111',
    '0000000010101000100000000',
    '1000001011001101111001110',
    '1101100110110001100101001',
    '1111101111010011011010100',
    '0101000101101001011101101',
    '0010011010111010010101011',
    '1011010001001010001011010',
    '1010101010100010010100100',
    '1000100001110000010000011',
    '1011101000000100111110111',
    '0000000011011011100010100',
    '1111111001010110101011000',
    '1000001001001010100010100',
    '1011101000010100111111100',
    '1011101000111001000100111',
    '1011101001000100110011101',
    '1000001000010010111001101',
    '1111111011110010000011001'
  ] };
  var SHARE = { ctx: null };
  var SANS = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  var MONO = 'ui-monospace,Menlo,Consolas,"Courier New",monospace';
  var PAPER = '#F4F1E8', INK = '#17160F', SUB = '#6F6A5C',
      HAIR = 'rgba(23,22,15,0.16)', RED = '#C2391A', REDBG = 'rgba(194,57,26,0.10)';
  var COLS = ['#FF6B4A', '#4D8DFF', '#3DDC84'];
  function chipOutline(text, rightX, y, fg, stroke) {
    var c = SHARE.ctx;
    c.font = '600 23px ' + SANS;
    var w = c.measureText(text).width + 36;
    c.strokeStyle = stroke; c.lineWidth = 1.5;
    rrPath(c, rightX - w, y, w, 42, 21); c.stroke();
    c.fillStyle = fg; c.textAlign = 'center';
    c.fillText(text, rightX - w / 2, y + 29);
    c.textAlign = 'left';
    return rightX - w - 14;
  }
  function shFit(t, font, maxW) {
    var c = SHARE.ctx;
    c.font = font;
    if (c.measureText(t).width <= maxW) return t;
    while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function shFrame(x, y, w, h) {
    var c = SHARE.ctx;
    c.fillStyle = '#FFFDF8'; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(23,22,15,0.55)'; c.lineWidth = 1.5; c.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    c.strokeStyle = 'rgba(23,22,15,0.22)'; c.lineWidth = 0.75; c.strokeRect(x + 5, y + 5, w - 10, h - 10);
  }
  function shDimRank(m, d) {
    var v = sv(m, d), r = 1, n = 0;
    for (var k = 0; k < ALL.length; k++) {
      if (!has(ALL[k], d)) continue;
      n++;
      if (ALL[k].name !== m.name && sv(ALL[k], d) > v) r++;
    }
    return { r: r, n: n };
  }
  function shPoolRank(m) {
    var pool = ranked();
    for (var k = 0; k < pool.length; k++) if (pool[k].m.name === m.name) return k + 1;
    return pool.length;
  }
  function shSigmaOf(m) {
    var pool = ranked();
    for (var k = 0; k < pool.length; k++) if (pool[k].m.name === m.name) return pool[k].s;
    return 3;
  }
  function shSceneShort(n) {
    if (n.indexOf('自媒体') === 0) return '自媒体';
    if (n.indexOf('Agent') === 0) return '智能体';
    if (n.indexOf('代码') === 0) return '代码';
    if (n.indexOf('RAG') === 0) return 'RAG';
    return '日常';
  }
  function shRuns(m, N) {
    var vs = [], runs = [], cur = null, start = 0;
    for (var q = 0; q < N; q++) vs.push(has(m, DIMS[q]) ? clamp(sv(m, DIMS[q])) : null);
    if (vs.some(function (v) { return v === null; })) { while (vs[start] !== null) start++; }
    for (var q = 0; q < N; q++) {
      var kk = (start + q) % N;
      if (vs[kk] === null) cur = null;
      else { if (!cur) { cur = []; runs.push(cur); } cur.push(kk); }
    }
    return { vs: vs, runs: runs };
  }
  function shPoly(m, col, lw, fill, RX, RCY, R) {
    var c = SHARE.ctx, N = DIMS.length, d = shRuns(m, N);
    d.runs.forEach(function (run) {
      c.beginPath();
      run.forEach(function (r2, j) {
        var a2 = (-90 + r2 * 360 / N) * Math.PI / 180;
        var px = RX + d.vs[r2] / 100 * R * Math.cos(a2), py = RCY + d.vs[r2] / 100 * R * Math.sin(a2);
        if (j) c.lineTo(px, py); else c.moveTo(px, py);
      });
      if (run.length === N) c.closePath();
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (fill && run.length === N) { c.fillStyle = col; c.globalAlpha = 0.12; c.fill(); c.globalAlpha = 1; }
      c.strokeStyle = col; c.lineWidth = lw; c.stroke();
    });
  }
  function shRadarBase(RX, RCY, R, ringCol) {
    var c = SHARE.ctx, N = DIMS.length;
    [25, 50, 75, 100].forEach(function (r) {
      c.beginPath();
      for (var k = 0; k < N; k++) {
        var a = (-90 + k * 360 / N) * Math.PI / 180;
        var px = RX + r / 100 * R * Math.cos(a), py = RCY + r / 100 * R * Math.sin(a);
        if (k) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath();
      c.strokeStyle = r === 50 ? ringCol : 'rgba(23,22,15,0.14)';
      c.lineWidth = r === 50 ? 1.5 : 1;
      c.setLineDash(r === 50 ? [4, 6] : []);
      c.globalAlpha = r === 50 ? 0.55 : 1;
      c.stroke();
      c.globalAlpha = 1;
    });
    c.setLineDash([]);
    for (var k = 0; k < N; k++) {
      var ang = (-90 + k * 360 / N) * Math.PI / 180;
      c.strokeStyle = 'rgba(23,22,15,0.10)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(RX, RCY);
      c.lineTo(RX + R * Math.cos(ang), RCY + R * Math.sin(ang)); c.stroke();
      c.fillStyle = SUB; c.font = '500 20px ' + SANS; c.textAlign = 'center';
      c.fillText(CARD_DIM_MINI[DIMS[k]], RX + (R + 24) * Math.cos(ang), RCY + (R + 24) * Math.sin(ang) + 7);
      c.textAlign = 'left';
    }
  }
  function shQr(qx, qy, QS) {
    var c = SHARE.ctx;
    shFrame(qx, qy, QS, QS);
    var n = XHS_QR.n, quiet = 3;
    var mod = (QS - 20) / (n + quiet * 2);
    var ox = qx + 10 + quiet * mod, oy = qy + 10 + quiet * mod;
    function eye(cx, cy) {
      var sz = mod * 7;
      c.fillStyle = INK;
      rrPath(c, ox + cx * mod, oy + cy * mod, sz, sz, mod * 1.8); c.fill();
      c.fillStyle = '#FFFDF8';
      rrPath(c, ox + (cx + 1) * mod, oy + (cy + 1) * mod, mod * 5, mod * 5, mod * 1.2); c.fill();
      c.fillStyle = INK;
      rrPath(c, ox + (cx + 2) * mod, oy + (cy + 2) * mod, mod * 3, mod * 3, mod * 0.9); c.fill();
    }
    for (var r = 0; r < n; r++) {
      var row = XHS_QR.rows[r];
      for (var cc = 0; cc < n; cc++) {
        if (row.charAt(cc) !== '1') continue;
        var inEye = (r < 7 && cc < 7) || (r < 7 && cc >= n - 7) || (r >= n - 7 && cc < 7);
        if (inEye) continue;
        c.fillStyle = INK;
        rrPath(c, ox + cc * mod + mod * 0.09, oy + r * mod + mod * 0.09, mod * 0.82, mod * 0.82, mod * 0.28);
        c.fill();
      }
    }
    eye(0, 0); eye(n - 7, 0); eye(0, n - 7);
  }
  /* 页脚作者角（两卡共用）：左＝头像+账号+ID+CTA+免责+版本行，右＝二维码。
     topY＝页脚块顶；返回块高（QR 156 + 标签行）。 */
  function shFooter(topY, Wc, Mc) {
    var c = SHARE.ctx;
    var QS = 156;
    var qx = Wc - Mc - QS, qy = topY;
    shQr(qx, qy, QS);
    c.fillStyle = SUB; c.font = '500 18px ' + SANS; c.textAlign = 'center';
    c.fillText('扫码 · 小红书找到我', qx + QS / 2, qy + QS + 26);
    c.textAlign = 'left';
    var lx = Mc, avD = authorImg ? 54 : 0, ay = qy + 4;
    if (authorImg) {
      c.save();
      c.beginPath(); c.arc(lx + avD / 2, ay + avD / 2, avD / 2, 0, Math.PI * 2); c.clip();
      c.drawImage(authorImg, lx, ay, avD, avD);
      c.restore();
      c.strokeStyle = 'rgba(23,22,15,0.3)'; c.lineWidth = 2;
      c.beginPath(); c.arc(lx + avD / 2, ay + avD / 2, avD / 2, 0, Math.PI * 2); c.stroke();
    }
    var tx = lx + (authorImg ? avD + 18 : 0);
    c.fillStyle = INK; c.font = '800 30px ' + SANS;
    c.fillText(AUTHOR.name ? '@' + AUTHOR.name : '', tx, ay + 26);
    c.fillStyle = SUB; c.font = '500 19px ' + SANS;
    c.fillText('小红书号 ' + AUTHOR.xhsId + ' · 扫码复现本对比 · 关注蹲新模型更新', tx, ay + 55);
    c.strokeStyle = HAIR; c.lineWidth = 1;
    c.beginPath(); c.moveTo(lx, qy + 86); c.lineTo(qx - 28, qy + 86); c.stroke();
    c.fillStyle = SUB; c.font = '400 19px ' + SANS;
    c.fillText('分数为基准族内位次分（0-100，50＝池内中位）· 缺数据 ≠ 0 · 来源：公开榜单聚合', lx, qy + 118);
    c.font = '500 17px ' + MONO;
    c.fillText('MODEL RADAR · VOL.' + String(META.built || '').slice(0, 10), lx, qy + 148);
    return QS + 34;
  }
  /* 按当前账本推导模型优/弱维度：计分维按位次分降序，取前 want 项 */
  function shTopDims(m, want) {
    var scored = DIMS.filter(function (d) { return has(m, d); });
    scored.sort(function (a, b) { return sv(m, b) - sv(m, a); });
    return scored.slice(0, want);
  }
  function compareTrio() {
    var scene = sceneByName(state.scene);
    var pool = ranked();
    var picked = state.selected.map(function (n) { return MODEL_IX[n]; }).filter(Boolean);
    var trio;
    if (picked.length >= 2) trio = picked.slice(0, 3);
    else if (picked.length === 1) {
      var opp = null;
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].m.name === picked[0].name) continue;
        opp = pool[i].m; break;
      }
      trio = [picked[0], opp].filter(Boolean);
    } else trio = pool.slice(0, 3).map(function (r) { return r.m; });
    trio.sort(function (a, b) { return composite(b, scene) - composite(a, scene); });
    return trio;
  }
  function newCard() {
    var c = document.createElement('canvas');
    c.width = 1200; c.height = 1600;
    SHARE.ctx = c.getContext('2d');
    var ctx = SHARE.ctx;
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, 1200, 1600);
    return c;
  }
  /* ═══ 分享卡 v10「对比卡」——信息密度重排版。
         墨带＝每模型完整档案列：公司·开源/闭源·覆盖 n/8 + 综合分/名次章/±σ + 优(2)/弱(1)明细行
         （维度·分值·全池名次；双模型附「较对手」差值；全部由当期账本推导，不写死文案）；
         结论行数据化（领先幅度 / 噪声级判定）；纸面＝五场景名次条 + 雷达与八维读数双栏；
         页脚＝作者角（头像·账号·二维码，shFooter 两卡共用）。 ═══ */
  function drawCompareCard() {
    var W = 1200, H = 1600, M = 64;
    var c = newCard();
    var ctx = SHARE.ctx;
    var scene = sceneByName(state.scene);
    var trio = compareTrio();
    var nCols = trio.length;
    var pool = ranked();
    var DIMW = nCols === 2 ? 160 : 152;   /* 优/弱行：分值列起点 */
    var SCW = nCols === 2 ? 236 : 218;    /* 优/弱行：名次列起点 */
    var DFW = nCols === 2 ? 300 : 0;      /* 优/弱行：「较对手」起点（仅双模型） */
    /* ── 墨色刊头＝档案带 ── */
    var BH = 552;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, BH);
    ctx.fillStyle = '#FF6B4A'; rrPath(ctx, M, 48, 36, 36, 9); ctx.fill();
    ctx.fillStyle = PAPER; ctx.font = '800 30px ' + SANS;
    ctx.fillText('模型雷达', M + 50, 76);
    var chipR = W - M;
    chipR = chipOutline(scene.name, chipR, 44, PAPER, 'rgba(244,241,232,0.45)') - 4;
    chipR = chipOutline(scopeLabel(), chipR, 44, 'rgba(244,241,232,0.72)', 'rgba(244,241,232,0.25)');
    ctx.fillStyle = 'rgba(244,241,232,0.55)'; ctx.font = '600 22px ' + SANS;
    ctx.fillText((state.selected.length >= 2 ? '模型对比' : (state.selected.length === 1 ? '自动对比 · 场景第一' : '本期场景 Top 3')) + ' · ' + shSceneShort(scene.name) + '场景加权综合', M, 130);
    var colW = (W - 2 * M) / nCols;
    for (var ci = 0; ci < nCols; ci++) {
      var m = trio[ci], col = COLS[ci % 3];
      var x0 = M + ci * colW;
      var nameF = nCols === 2 ? 30 : 26;
      ctx.fillStyle = col; ctx.font = '800 ' + nameF + 'px ' + SANS;
      ctx.fillText(shFit(m.name, '800 ' + nameF + 'px ' + SANS, colW - 20), x0, 190);
      ctx.fillStyle = 'rgba(244,241,232,0.58)'; ctx.font = '500 19px ' + SANS;
      ctx.fillText((m.company || '公司未标注') + ' · ' + (m.open === true ? '开源' : (m.open === false ? '闭源' : '开源未确认')) + ' · 覆盖 ' + coverage(m) + '/8', x0, 224);
      ctx.fillStyle = PAPER; ctx.font = '900 76px ' + SANS;
      var cTxt = fmt(composite(m, scene));
      ctx.fillText(cTxt, x0 - 2, 316);
      var numW = ctx.measureText(cTxt).width;
      ctx.font = '800 24px ' + SANS;
      var rkT = '#' + shPoolRank(m);
      var rkW = ctx.measureText(rkT).width + 26;
      ctx.fillStyle = RED; rrPath(ctx, x0 + numW + 18, 258, rkW, 44, 9); ctx.fill();
      ctx.fillStyle = PAPER; ctx.fillText(rkT, x0 + numW + 31, 288);
      ctx.fillStyle = 'rgba(244,241,232,0.55)'; ctx.font = '500 19px ' + SANS;
      ctx.fillText('±' + fmt(shSigmaOf(m)), x0 + numW + 18, 344);
      ctx.strokeStyle = 'rgba(244,241,232,0.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, 372); ctx.lineTo(x0 + colW - 20, 372); ctx.stroke();
      /* 优(2)/弱(1)明细：维度 · 分值 · 全池名次；双模型附较对手差值 */
      var tops = shTopDims(m, 2);
      var allS = DIMS.filter(function (d) { return has(m, d); });
      var weak = null;
      if (allS.length > 2) {
        allS.sort(function (a, b) { return sv(m, a) - sv(m, b); });
        weak = allS[0];
      }
      var yy = 412;
      function dline(tag, d) {
        var dr = shDimRank(m, d);
        ctx.fillStyle = 'rgba(244,241,232,0.5)'; ctx.font = '700 18px ' + SANS;
        ctx.fillText(tag, x0, yy);
        ctx.fillStyle = 'rgba(244,241,232,0.92)'; ctx.font = '600 20px ' + SANS;
        ctx.fillText(CARD_DIM[d] || d, x0 + 30, yy);
        ctx.fillStyle = col; ctx.font = '800 21px ' + SANS;
        ctx.fillText(fmt(clamp(sv(m, d))), x0 + DIMW, yy);
        ctx.fillStyle = 'rgba(244,241,232,0.55)'; ctx.font = '600 17px ' + SANS;
        ctx.fillText((tag === '弱' && dr.r <= 3 ? '全池 #' + dr.r : '#' + dr.r + '/' + dr.n), x0 + SCW, yy);
        if (DFW) {
          var other = trio[1 - ci];
          if (has(other, d)) {
            var df = sv(m, d) - sv(other, d);
            ctx.fillStyle = 'rgba(244,241,232,0.5)'; ctx.font = '500 17px ' + SANS;
            ctx.fillText('较对手', x0 + DFW, yy);
            ctx.fillStyle = col; ctx.font = '800 18px ' + SANS;
            ctx.fillText((df >= 0 ? '+' : '−') + fmt(Math.abs(df)), x0 + DFW + 62, yy);
          }
        }
        yy += 35;
      }
      tops.forEach(function (d) { dline('优', d); });
      if (weak) dline('弱', weak);
    }
    /* 结论行（数据化） */
    var verdict = '';
    if (nCols === 2) {
      var aC = composite(trio[0], scene), bC = composite(trio[1], scene);
      var diff = aC - bC;
      var tied = Math.abs(diff) <= tieThreshold(shSigmaOf(trio[0]), shSigmaOf(trio[1]), sigmaRef(pool));
      verdict = tied
        ? '综合 ' + fmt(aC) + ' ≈ ' + fmt(bC) + '（差 ' + fmt(Math.abs(diff)) + '，噪声级）——建议两个都试'
        : trio[0].name + ' 领先 +' + fmt(diff);
    } else {
      var v1 = composite(trio[0], scene), v2 = composite(trio[1], scene), v3 = composite(trio[2], scene);
      var d12 = v1 - v2;
      var tie12 = Math.abs(d12) <= tieThreshold(shSigmaOf(trio[0]), shSigmaOf(trio[1]), sigmaRef(pool));
      verdict = tie12
        ? '#1 与 #2 分差 ' + fmt(Math.abs(d12)) + '，噪声级（±σ 内）——前二属同一梯队'
        : trio[0].name + ' 领先 #2 +' + fmt(d12) + ' · 领先 #3 +' + fmt(v1 - v3);
    }
    ctx.fillStyle = PAPER; ctx.font = '600 27px ' + SANS;
    ctx.fillText(shFit(verdict, '600 27px ' + SANS, W - 2 * M), M, 522);
    ctx.fillStyle = RED; ctx.fillRect(0, BH - 6, W, 6);
    /* 五场景名次对比条 */
    var FY = BH + 26, FH = 108;
    shFrame(M, FY, W - 2 * M, FH);
    var cellW = (W - 2 * M) / 5;
    for (var si = 0; si < SCENES.length && si < 5; si++) {
      var scn = SCENES[si];
      var cur = scn.name === scene.name;
      var cx0 = M + si * cellW;
      if (cur) { ctx.fillStyle = REDBG; ctx.fillRect(cx0 + 6, FY + 6, cellW - 12, FH - 12); }
      ctx.textAlign = 'center';
      ctx.fillStyle = cur ? RED : SUB; ctx.font = '500 22px ' + SANS;
      ctx.fillText(shSceneShort(scn.name), cx0 + cellW / 2, FY + 40);
      var rkFont = nCols === 2 ? '800 32px ' : '800 26px ';
      var gap = nCols === 2 ? 28 : 14;
      var seg = [];
      for (var ci = 0; ci < nCols; ci++) {
        var rk = 1;
        for (var k = 0; k < ALL.length; k++) {
          if (ALL[k].name === trio[ci].name) continue;
          if (composite(ALL[k], scn) > composite(trio[ci], scn)) rk++;
        }
        seg.push('#' + rk);
      }
      var totW = 0;
      ctx.font = rkFont + SANS;
      for (var ci = 0; ci < seg.length; ci++) totW += ctx.measureText(seg[ci]).width;
      totW += gap * (seg.length - 1);
      var sx = cx0 + cellW / 2 - totW / 2, sy = FY + 88;
      for (var ci = 0; ci < seg.length; ci++) {
        ctx.fillStyle = COLS[ci % 3]; ctx.font = rkFont + SANS; ctx.textAlign = 'left';
        ctx.fillText(seg[ci], sx, sy);
        ctx.font = rkFont + SANS;
        sx += ctx.measureText(seg[ci]).width + gap;
      }
      ctx.textAlign = 'left';
      if (si) { ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx0, FY + 10); ctx.lineTo(cx0, FY + FH - 10); ctx.stroke(); }
    }
    /* 雷达 + 名次清单 双栏 */
    var PY = FY + FH + 26, PH = 628;
    shFrame(M, PY, W - 2 * M, PH);
    ctx.fillStyle = INK; ctx.font = '700 27px ' + SANS;
    ctx.fillText('八维能力 · 位次分对比', M + 28, PY + 46);
    ctx.fillStyle = SUB; ctx.font = '500 21px ' + SANS; ctx.textAlign = 'right';
    ctx.fillText('0-100 位次分 · 50＝池内中位', W - M - 28, PY + 44);
    ctx.textAlign = 'left';
    var LX = M + 500, nameW = nCols === 2 ? 140 : 122;
    var colW2 = (W - M - 28 - LX - nameW) / nCols;
    var hdrF = nCols === 2 ? '800 20px ' : '800 18px ';
    for (var ci = 0; ci < nCols; ci++) {
      var nf = nCols === 2 ? 20 : 18;
      ctx.font = '800 ' + nf + 'px ' + SANS;
      while (nf > 13 && ctx.measureText(trio[ci].name).width > colW2 - 8) { nf -= 0.5; ctx.font = '800 ' + nf + 'px ' + SANS; }
      ctx.fillStyle = COLS[ci % 3]; ctx.textAlign = 'right';
      ctx.fillText(trio[ci].name, LX + nameW + (ci + 1) * colW2 - 8, PY + 104);
    }
    ctx.textAlign = 'left';
    var RX = M + 250, RCY = PY + 400, R = 185;
    shRadarBase(RX, RCY, R, 'rgba(194,57,26,0.55)');
    for (var ci = nCols - 1; ci >= 1; ci--) shPoly(trio[ci], COLS[ci % 3], 3.5, false, RX, RCY, R);
    shPoly(trio[0], COLS[0], 5.5, true, RX, RCY, R);
    var rowY = PY + 156, rowH = 58;
    for (var k = 0; k < DIMS.length; k++) {
      var d = DIMS[k];
      ctx.fillStyle = INK; ctx.font = '600 24px ' + SANS;
      ctx.fillText(CARD_DIM[d] || d, LX, rowY);
      for (var ci = 0; ci < nCols; ci++) {
        var m = trio[ci], col = COLS[ci % 3];
        var cRight = LX + nameW + (ci + 1) * colW2 - 8;
        ctx.textAlign = 'right';
        if (has(m, d)) {
          var dr = shDimRank(m, d);
          var isWin = true;
          for (var cj = 0; cj < nCols; cj++) {
            if (cj !== ci && has(trio[cj], d) && sv(trio[cj], d) > sv(m, d)) isWin = false;
          }
          var sOff = nCols === 2 ? 82 : 54;
          var sSz = nCols === 2 ? 28 : 23;
          var rSz = nCols === 2 ? 17 : 13;
          ctx.fillStyle = col; ctx.font = (isWin ? '800 ' : '500 ') + sSz + 'px ' + SANS;
          ctx.fillText(fmt(clamp(sv(m, d))), cRight - sOff, rowY);
          ctx.fillStyle = RED; ctx.font = '700 ' + rSz + 'px ' + SANS;
          ctx.fillText('#' + dr.r + '/' + dr.n, cRight, rowY);
        } else {
          ctx.fillStyle = SUB; ctx.font = '500 21px ' + SANS;
          ctx.fillText('待定', cRight, rowY);
        }
        ctx.textAlign = 'left';
      }
      if (k < DIMS.length - 1) { ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(LX, rowY + 17); ctx.lineTo(W - M - 28, rowY + 17); ctx.stroke(); }
      rowY += rowH;
    }
    /* 页脚作者角（头像·账号·二维码，与档案卡共用） */
    shFooter(PY + PH + 26, W, M);
    return c;
  }
  function drawProfileCard(m) {
    var W = 1200, H = 1600, M = 72;
    var c = newCard();
    var ctx = SHARE.ctx;
    var scene = sceneByName(state.scene);
    var heroCol = COLS[0];
    var BH = 484;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, BH);
    ctx.fillStyle = '#FF6B4A'; rrPath(ctx, M, 56, 38, 38, 9); ctx.fill();
    ctx.fillStyle = PAPER; ctx.font = '800 32px ' + SANS;
    ctx.fillText('模型雷达', M + 52, 84);
    var chipR = W - M;
    chipR = chipOutline('能力档案', chipR, 52, PAPER, 'rgba(244,241,232,0.45)') - 4;
    chipR = chipOutline(shSceneShort(scene.name) + '场景', chipR, 52, 'rgba(244,241,232,0.72)', 'rgba(244,241,232,0.25)');
    var nameF = 88;
    while (nameF > 52) { ctx.font = '900 ' + nameF + 'px ' + SANS; if (ctx.measureText(m.name).width <= W - 2 * M) break; nameF -= 6; }
    ctx.fillStyle = PAPER; ctx.font = '900 ' + nameF + 'px ' + SANS;
    ctx.fillText(shFit(m.name, '900 ' + nameF + 'px ' + SANS, W - 2 * M), M, 252);
    ctx.fillStyle = 'rgba(244,241,232,0.62)'; ctx.font = '500 26px ' + SANS;
    ctx.fillText((m.company || '公司未标注') + ' · 覆盖 ' + coverage(m) + '/8 维 · ' + scene.name, M, 300);
    ctx.fillStyle = 'rgba(244,241,232,0.55)'; ctx.font = '600 22px ' + SANS;
    ctx.fillText('场景加权综合', M, 356);
    ctx.fillStyle = PAPER; ctx.font = '900 96px ' + SANS;
    var cTxt = fmt(composite(m, scene));
    ctx.fillText(cTxt, M - 3, 446);
    var numW = ctx.measureText(cTxt).width;
    ctx.font = '800 25px ' + SANS;
    var rkT = '#' + shPoolRank(m);
    var rkW = ctx.measureText(rkT).width + 28;
    ctx.fillStyle = RED; rrPath(ctx, M + numW + 24, 378, rkW, 46, 9); ctx.fill();
    ctx.fillStyle = PAPER; ctx.fillText(rkT, M + numW + 38, 409);
    ctx.fillStyle = 'rgba(244,241,232,0.55)'; ctx.font = '500 21px ' + SANS;
    ctx.fillText('±' + fmt(shSigmaOf(m)), M + numW + 24, 452);
    ctx.fillStyle = RED; ctx.fillRect(0, BH - 6, W, 6);
    /* 五场景名次（单模型） */
    var FY = BH + 30, FH = 104;
    shFrame(M, FY, W - 2 * M, FH);
    var cellW = (W - 2 * M) / 5;
    for (var si = 0; si < SCENES.length && si < 5; si++) {
      var scn = SCENES[si];
      var cur = scn.name === scene.name;
      var cx0 = M + si * cellW;
      if (cur) { ctx.fillStyle = REDBG; ctx.fillRect(cx0 + 6, FY + 6, cellW - 12, FH - 12); }
      var rk = 1;
      for (var k = 0; k < ALL.length; k++) {
        if (ALL[k].name === m.name) continue;
        if (composite(ALL[k], scn) > composite(m, scn)) rk++;
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = cur ? RED : SUB; ctx.font = '500 22px ' + SANS;
      ctx.fillText(shSceneShort(scn.name), cx0 + cellW / 2, FY + 40);
      ctx.fillStyle = cur ? RED : INK; ctx.font = '800 34px ' + SANS;
      ctx.fillText('#' + rk, cx0 + cellW / 2, FY + 86);
      ctx.textAlign = 'left';
      if (si) { ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx0, FY + 12); ctx.lineTo(cx0, FY + FH - 12); ctx.stroke(); }
    }
    /* 雷达 + 清单 双栏 */
    var PY = FY + FH + 30, PH = 646;
    shFrame(M, PY, W - 2 * M, PH);
    ctx.fillStyle = INK; ctx.font = '700 27px ' + SANS;
    ctx.fillText('八维能力 · 位次分', M + 28, PY + 48);
    ctx.fillStyle = SUB; ctx.font = '500 21px ' + SANS; ctx.textAlign = 'right';
    ctx.fillText('50＝池内中位 · 红字为全池名次', W - M - 28, PY + 46);
    ctx.textAlign = 'left';
    var RX = M + 276, RCY = PY + 408, R = 198;
    shRadarBase(RX, RCY, R, 'rgba(194,57,26,0.55)');
    shPoly(m, heroCol, 5.5, true, RX, RCY, R);
    var LX = M + 560, LW = W - M - 28 - LX;
    var rowY = PY + 150, rowH = 60;
    for (var k = 0; k < DIMS.length; k++) {
      var d = DIMS[k];
      ctx.fillStyle = INK; ctx.font = '600 24px ' + SANS;
      ctx.fillText(CARD_DIM[d] || d, LX, rowY);
      ctx.textAlign = 'right';
      if (has(m, d)) {
        var dr = shDimRank(m, d);
        ctx.fillStyle = heroCol; ctx.font = '800 30px ' + SANS;
        ctx.fillText(fmt(clamp(sv(m, d))), LX + LW - 150, rowY);
        ctx.fillStyle = RED; ctx.font = '700 19px ' + SANS;
        ctx.fillText('#' + dr.r + '/' + dr.n, LX + LW - 52, rowY);
        ctx.fillStyle = SUB; ctx.font = '500 19px ' + SANS;
        ctx.fillText('±' + fmt(sceneSigmaCached(m, scene)), LX + LW, rowY);
      } else {
        ctx.fillStyle = SUB; ctx.font = '500 21px ' + SANS;
        ctx.fillText('待定', LX + LW, rowY);
      }
      ctx.textAlign = 'left';
      if (k < DIMS.length - 1) { ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(LX, rowY + 17); ctx.lineTo(W - M - 28, rowY + 17); ctx.stroke(); }
      rowY += rowH;
    }
    /* 强项 / 待加强 */
    var scored = DIMS.filter(function (d) { return has(m, d); });
    scored.sort(function (a, b) { return sv(m, b) - sv(m, a); });
    if (scored.length >= 2) {
      var t1 = scored[0], t2 = scored[1], wk = scored[scored.length - 1];
      var d1 = shDimRank(m, t1), d2 = shDimRank(m, t2), dw = shDimRank(m, wk);
      var line = '最强　' + (CARD_DIM[t1] || t1) + ' #' + d1.r + '/' + d1.n + ' · ' + (CARD_DIM[t2] || t2) + ' #' + d2.r + '/' + d2.n +
                 '　　待加强　' + (CARD_DIM[wk] || wk) + ' #' + dw.r + '/' + dw.n;
      ctx.fillStyle = INK; ctx.font = '600 24px ' + SANS;
      ctx.fillText(shFit(line, '600 24px ' + SANS, W - 2 * M), M, PY + PH + 44);
    }
    /* 页脚作者角（头像·账号·二维码，与对比卡共用） */
    shFooter(PY + PH + 72, W, M);
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
  function buildImageSet() {
    var trio = compareTrio();
    var imgs = [{ title: '对比总览', draw: drawCompareCard }];
    var src = state.selected.length
      ? state.selected.map(function (n) { return MODEL_IX[n]; }).filter(Boolean)
      : trio;
    src.forEach(function (m) {
      imgs.push({ title: m.name, draw: function () { return drawProfileCard(m); } });
    });
    return imgs;
  }
  function buildSheet() {
    var scrim = el('div', 'sheet-scrim');
    var sh = el('div', 'sheet');
    var h = el('div', 'sheet-h');
    h.appendChild(el('b', '', '分享卡 · 套图'));
    var x = el('button', '', '✕');
    x.setAttribute('aria-label', '关闭');
    x.addEventListener('click', closeShare);
    h.appendChild(x);
    sh.appendChild(h);
    var img = el('img', 'sheet-img');
    img.alt = '分享卡预览';
    sh.appendChild(img);
    var thumbs = el('div', 'sheet-thumbs');
    sh.appendChild(thumbs);
    var btns = el('div', 'sheet-btns');
    var bp = el('button', 'primary', '发笔记');
    var bc = el('button', 'ghost', '发评论晒卡');
    var bs = el('button', 'ghost', '存相册');
    btns.appendChild(bp); btns.appendChild(bc); btns.appendChild(bs);
    sh.appendChild(btns);
    sh.appendChild(el('div', 'sheet-hint',
      '点缩略图勾选要输出的卡（至少一张）；「发笔记」支持多图；「发评论晒卡」把卡发到笔记评论区（需客户端 9.49+），别人从评论区重开工具可恢复本次对比。'));
    scrim.addEventListener('click', closeShare);
    bp.addEventListener('click', doPostNote);
    bc.addEventListener('click', doComment);
    bs.addEventListener('click', doSaveAlbum);
    document.body.appendChild(scrim);
    document.body.appendChild(sh);
    sheetEls = { scrim: scrim, sh: sh, img: img, thumbs: thumbs, bp: bp, bc: bc, bs: bs, busy: false, images: [], picked: [], cur: 0 };
  }
  function openShare() {
    if (!gate.unlocked) { gateFollow(); return; }
    if (!sheetEls) buildSheet();
    sheetEls.images = buildImageSet().map(function (it) {
      var cv = it.draw();
      return { title: it.title, url: cv.toDataURL('image/png') };
    });
    sheetEls.picked = sheetEls.images.map(function (_, i) { return i; });
    sheetEls.cur = 0;
    renderThumbs();
    setPreview(0);
    sheetEls.scrim.classList.add('on');
    sheetEls.sh.classList.add('on');
    haptic('light');
  }
  function closeShare() {
    if (!sheetEls) return;
    sheetEls.scrim.classList.remove('on');
    sheetEls.sh.classList.remove('on');
  }
  function renderThumbs() {
    var t = sheetEls.thumbs;
    t.textContent = '';
    sheetEls.images.forEach(function (it, i) {
      var d = el('div', 'thumb' + (i === sheetEls.cur ? ' cur' : '') + (sheetEls.picked.indexOf(i) >= 0 ? ' pick' : ''));
      var im = el('img');
      im.src = it.url; im.alt = it.title;
      d.appendChild(im);
      var pk = el('span', 'pk', sheetEls.picked.indexOf(i) >= 0 ? '✓' : '');
      pk.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var pi = sheetEls.picked.indexOf(i);
        if (pi >= 0 && sheetEls.picked.length > 1) sheetEls.picked.splice(pi, 1);
        else if (pi < 0) sheetEls.picked.push(i);
        renderThumbs();
      });
      d.appendChild(pk);
      var cap = el('span', 'cap', it.title);
      d.appendChild(cap);
      d.addEventListener('click', function () {
        sheetEls.cur = i;
        setPreview(i);
        renderThumbs();
      });
      t.appendChild(d);
    });
  }
  function setPreview(i) { sheetEls.img.src = sheetEls.images[i].url; }
  function pickedImageURLs(cb) {
    var mt = window.xhs && window.xhs.miniTool;
    var picks = sheetEls.picked.slice().sort(function (a, b) { return a - b; }).map(function (i) { return sheetEls.images[i]; });
    var paths = [], k = 0;
    var next = function () {
      if (k >= picks.length) return cb(paths);
      var it = picks[k++];
      if (mt && typeof mt.writeTempFile === 'function')
        mt.writeTempFile({ data: it.url }).then(function (r) { paths.push(r.filePath); next(); })
          .catch(function () { paths.push(it.url); next(); });
      else { paths.push(it.url); next(); }
    };
    next();
  }
  function doPostNote() {
    haptic('light');
    if (!miniToolOk('postNote')) { toast('浏览器预览：真实容器内此处唤起小红书发布页'); return; }
    if (sheetEls.busy) return;
    sheetEls.busy = true;
    var mt = window.xhs.miniTool;
    var fin = function (err) {
      sheetEls.busy = false;
      if (err) toast('唤起发布页失败' + (err && err.errCode ? '（' + err.errCode + '）' : ''));
      else toast('发布页已唤起——记得点「发布」哦');
    };
    pickedImageURLs(function (paths) {
      mt.postNote({ title: '模型雷达 · 我的选型', content: shareText(),
                    pageType: 'photo_publish',
                    mediaInfo: { image_resources: paths.map(function (u) { return { url: u }; }) } })
        .then(function () { fin(null); }).catch(fin);
    });
  }
  function doComment() {
    haptic('light');
    var mt = window.xhs && window.xhs.miniTool;
    if (!mt || typeof mt.interactionOpenApi !== 'function') { toast('当前客户端不支持评论晒卡（需 9.49+）'); return; }
    if (gate.buildVersion && Math.floor(gate.buildVersion / 1000) < 9490) { toast('评论晒卡需要客户端 9.49+'); return; }
    if (sheetEls.busy) return;
    sheetEls.busy = true;
    pickedImageURLs(function (paths) {
      var snap = { scene: state.scene, scope: state.scope, models: state.selected.slice(0, 3), t: Date.now() };
      var snapStr = JSON.stringify(snap);
      if (snapStr.length > 2000) snapStr = JSON.stringify({ scene: state.scene, models: state.selected.slice(0, 3) });
      mt.interactionOpenApi({
        payload: { action: 'post_comment', content: shareText(),
                   media_bean: paths.map(function (p) { return { media_type: 'image', cover_image_url: p }; }),
                   miniToolSnapshotInfo: snapStr },
        saveToAlbum: false
      }).then(function (r) {
        sheetEls.busy = false;
        toast(r && r.routed ? '评论区已打开——发布后晒出对比' : '评论未打开，可重试');
      }).catch(function (err) {
        sheetEls.busy = false;
        var c = err && err.errCode;
        toast('打开评论失败' + (c ? '（' + c + '）' : ''));
      });
    });
  }
  function doSaveAlbum() {
    haptic('light');
    if (!miniToolOk('saveImageToPhotosAlbum')) { toast('浏览器预览：真实容器内此处保存到相册'); return; }
    if (sheetEls.busy) return;
    sheetEls.busy = true;
    var mt = window.xhs.miniTool;
    var okN = 0, failN = 0;
    pickedImageURLs(function (paths) {
      var k = 0;
      var next = function () {
        if (k >= paths.length) {
          sheetEls.busy = false;
          if (failN) toast('已保存 ' + okN + ' 张，' + failN + ' 张失败');
          else { haptic('medium'); toast('已保存 ' + okN + ' 张到相册 ✓'); }
          return;
        }
        var p = paths[k++];
        mt.saveImageToPhotosAlbum({ filePath: p }).then(function () { okN++; next(); })
          .catch(function () { failN++; next(); });
      };
      next();
    });
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
    if (s === 'inf' && !gate.unlocked) { gateFollow(); return; }
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
    if (!gate.unlocked && !state.more && !state.q.trim()) { gateFollow(); return; }
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
