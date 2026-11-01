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
    if (!gate.apiOK) { toast('浏览器预览：真实容器内此处拉起小红书关注面板'); return; }
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
    var sb = document.getElementById('share-btn');
    if (sb) sb.textContent = gate.unlocked ? '生成分享卡 ⤴' : '🔒 关注后生成分享卡';
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
    var sb = el('button', 'share-cta', gate.unlocked ? '生成分享卡 ⤴' : '🔒 关注后生成分享卡');
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
  /* ═══ 分享卡 v8b「对比卡」——本项目的主语是"对比"（用户定调）。
         墨色刊头带：两/三个模型并置（综合分+名次章+±σ）+ 自动结论行（应用内同款 tie 判定）；
         五场景名次对比条；雷达（形状）与双列名次清单（精确读数）左右双栏。
         单选＝自动对比场景第一；未选＝场景 Top 3。原创刊物语言。 ═══ */
  /* ★ 作者署名配置：填昵称/小红书号即显示在卡底（留空则不显示）；头像 author.png 放 xhs_template/ 重跑构建 */
  var AUTHOR = { name: '赛博摆渡人', xhsId: '', avatar: 'author.png' };
  var authorImg = null;
  (function () {
    var im = new Image();
    im.onload = function () { authorImg = im; };
    im.src = AUTHOR.avatar;
  })();
  /* 小红书二维码：矩阵由 python qrcode 库预生成，Canvas 自绘圆点风格。当前载荷=小红书号文本（待替换为主页短链接：用户提供二维码截图后解码替换） */
  var XHS_QR = { payload: "小红书号：49224513797", n: 25, rows: [
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
  var CARD_DIM = { '推理与知识': '推理与知识', '代码': '代码', '指令遵循': '指令遵循', 'Agent与工具调用': '智能体',
                   '长文本': '长文本', '可靠性与低幻觉': '可靠性', '内容创作': '内容创作', '图片与制图': '图片与制图' };
  var CARD_DIM_MINI = { '推理与知识': '推理', '代码': '代码', '指令遵循': '指令', 'Agent与工具调用': '智能',
                        '长文本': '长文', '可靠性与低幻觉': '可靠', '内容创作': '内容', '图片与制图': '图片' };
  function drawShareCard() {
    var W = 1080, H = 1440, M = 64;
    var SANS = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    var MONO = 'ui-monospace,Menlo,Consolas,"Courier New",monospace';
    var SERIF = 'Georgia,"Times New Roman","Songti SC","Noto Serif CJK SC",serif';
    var PAPER = '#F4F1E8', INK = '#17160F', SUB = '#6F6A5C',
        FRAME = 'rgba(23,22,15,0.55)', FRAME2 = 'rgba(23,22,15,0.22)', HAIR = 'rgba(23,22,15,0.16)',
        RED = '#C2391A', REDBG = 'rgba(194,57,26,0.10)';
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
    function framePanel(x, y, w, h) {
      ctx.fillStyle = '#FFFDF8'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = FRAME; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
      ctx.strokeStyle = FRAME2; ctx.lineWidth = 0.75; ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
    }
    function chipOutline(text, rightX, y, fg, stroke) {
      ctx.font = '600 23px ' + SANS;
      var w = ctx.measureText(text).width + 36;
      ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
      rrPath(ctx, rightX - w, y, w, 42, 21); ctx.stroke();
      ctx.fillStyle = fg; ctx.textAlign = 'center';
      ctx.fillText(text, rightX - w / 2, y + 29);
      ctx.textAlign = 'left';
      return rightX - w - 14;
    }
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);

    /* ── 对比数据 ── */
    var scene = sceneByName(state.scene);
    var pool = ranked();
    var picked = state.selected.map(function (n) { return MODEL_IX[n]; }).filter(Boolean);
    var trio = [];
    if (picked.length >= 2) {
      trio = picked.slice(0, 3);
    } else if (picked.length === 1) {
      var opp = null;
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].m.name === picked[0].name) continue;
        opp = pool[i].m; break;
      }
      trio = [picked[0], opp].filter(Boolean);
    } else {
      trio = pool.slice(0, 3).map(function (r) { return r.m; });
    }
    var autoNote = picked.length === 1 ? '自动对比 · 场景第一' : (picked.length === 0 ? '本期场景 Top 3' : '模型对比');
    trio.sort(function (a, b) { return composite(b, scene) - composite(a, scene); });
    var nCols = trio.length;
    function poolRank(m) {
      for (var k = 0; k < pool.length; k++) if (pool[k].m.name === m.name) return k + 1;
      return pool.length;
    }
    function sigmaOf(m) {
      for (var k = 0; k < pool.length; k++) if (pool[k].m.name === m.name) return pool[k].s;
      return 3;
    }
    function dimRank(m, d) {
      var v = sv(m, d), r = 1, n = 0;
      for (var k = 0; k < ALL.length; k++) {
        if (!has(ALL[k], d)) continue;
        n++;
        if (ALL[k].name !== m.name && sv(ALL[k], d) > v) r++;
      }
      return { r: r, n: n };
    }
    function sceneShort(n) {
      if (n.indexOf('自媒体') === 0) return '自媒体';
      if (n.indexOf('Agent') === 0) return '智能体';
      if (n.indexOf('代码') === 0) return '代码';
      if (n.indexOf('RAG') === 0) return 'RAG';
      return '日常';
    }

    /* ── 墨色刊头带 ── */
    var BH = 430;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, BH);
    ctx.fillStyle = '#FF6B4A'; rrPath(ctx, M, 50, 34, 34, 8); ctx.fill();
    ctx.fillStyle = PAPER; ctx.font = '800 30px ' + SANS;
    ctx.fillText('模型雷达', M + 48, 76);
    var chipR = W - M;
    chipR = chipOutline(scene.name, chipR, 46, PAPER, 'rgba(244,241,232,0.45)') - 4;
    chipR = chipOutline(scopeLabel(), chipR, 46, 'rgba(244,241,232,0.72)', 'rgba(244,241,232,0.25)');
    ctx.fillStyle = 'rgba(244,241,232,0.55)'; ctx.font = '600 24px ' + SANS;
    ctx.fillText(autoNote + ' · ' + sceneShort(scene.name) + '场景加权综合', M, 136);
    var colW = (W - 2 * M) / nCols;
    for (var ci = 0; ci < nCols; ci++) {
      var m = trio[ci], col = COLS[ci % 3];
      var x0 = M + ci * colW;
      ctx.fillStyle = col; ctx.font = '800 27px ' + SANS;
      ctx.fillText(fit(m.name, '800 27px ' + SANS, colW - 30), x0, 186);
      ctx.fillStyle = PAPER; ctx.font = '400 76px ' + SERIF;
      var numW = 0;
      var cTxt = fmt(composite(m, scene));
      ctx.fillText(cTxt, x0 - 3, 266);
      numW = ctx.measureText(cTxt).width;
      ctx.font = '800 24px ' + SANS;
      var rkT = '#' + poolRank(m);
      var rkW = ctx.measureText(rkT).width + 26;
      ctx.fillStyle = RED; rrPath(ctx, x0 + numW + 20, 222, rkW, 42, 8); ctx.fill();
      ctx.fillStyle = PAPER; ctx.fillText(rkT, x0 + numW + 33, 250);
      ctx.fillStyle = 'rgba(244,241,232,0.55)'; ctx.font = '500 22px ' + MONO;
      ctx.fillText('±' + fmt(sigmaOf(m)), x0 + numW + 20, 296);
    }
    var verdict = '';
    if (nCols === 2) {
      var aC = composite(trio[0], scene), bC = composite(trio[1], scene);
      var diff = aC - bC;
      var tied = Math.abs(diff) <= tieThreshold(sigmaOf(trio[0]), sigmaOf(trio[1]), sigmaRef(pool));
      verdict = tied
        ? '综合 ' + fmt(aC) + ' ≈ ' + fmt(bC) + '（差 ' + fmt(Math.abs(diff)) + '，噪声级）——建议两个都试'
        : trio[0].name + ' 领先 +' + fmt(diff);
    } else {
      var parts = [];
      for (var vi = 0; vi < nCols; vi++) parts.push(trio[vi].name + ' ' + fmt(composite(trio[vi], scene)));
      verdict = parts.join(' · ');
    }
    ctx.fillStyle = PAPER; ctx.font = '600 27px ' + SANS;
    ctx.fillText(fit(verdict, '600 27px ' + SANS, W - 2 * M), M, 372);
    ctx.fillStyle = RED; ctx.fillRect(0, BH - 6, W, 6);

    /* ── 五场景名次对比条 ── */
    var FY = BH + 32, FH = 110;
    framePanel(M, FY, W - 2 * M, FH);
    var cellW = (W - 2 * M) / 5;
    for (var si = 0; si < SCENES.length && si < 5; si++) {
      var scn = SCENES[si];
      var cur = scn.name === scene.name;
      var cx0 = M + si * cellW;
      if (cur) { ctx.fillStyle = REDBG; ctx.fillRect(cx0 + 6, FY + 6, cellW - 12, FH - 12); }
      ctx.textAlign = 'center';
      ctx.fillStyle = cur ? RED : SUB; ctx.font = '500 21px ' + SANS;
      ctx.fillText(sceneShort(scn.name), cx0 + cellW / 2, FY + 40);
      var rkFont = nCols === 2 ? '800 30px ' : '800 24px ';
      var gap = nCols === 2 ? 26 : 12;
      var seg = [];
      for (var ci = 0; ci < nCols; ci++) {
        var rk = 1;
        for (var k = 0; k < ALL.length; k++) {
          if (ALL[k].name === trio[ci].name) continue;
          if (composite(ALL[k], scn) > composite(trio[ci], scn)) rk++;
        }
        seg.push('#' + rk);
      }
      ctx.font = rkFont + SANS;
      var totW = 0;
      for (var ci = 0; ci < seg.length; ci++) totW += ctx.measureText(seg[ci]).width;
      totW += gap * (seg.length - 1);
      var sx = cx0 + cellW / 2 - totW / 2, sy = FY + 90;
      for (var ci = 0; ci < seg.length; ci++) {
        ctx.fillStyle = COLS[ci % 3]; ctx.font = rkFont + SANS; ctx.textAlign = 'left';
        ctx.fillText(seg[ci], sx, sy);
        ctx.font = rkFont + SANS;
        sx += ctx.measureText(seg[ci]).width + gap;
      }
      ctx.textAlign = 'left';
      if (si) { ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx0, FY + 12); ctx.lineTo(cx0, FY + FH - 12); ctx.stroke(); }
    }

    /* ── 雷达（左） + 双列名次清单（右）双栏面板 ── */
    var PY = FY + FH + 30, PH = 580;
    framePanel(M, PY, W - 2 * M, PH);
    ctx.fillStyle = INK; ctx.font = '700 25px ' + SANS;
    ctx.fillText('八维能力 · 位次分对比', M + 26, PY + 44);
    ctx.fillStyle = SUB; ctx.font = '500 20px ' + SANS; ctx.textAlign = 'right';
    ctx.fillText('50＝池内中位', W - M - 26, PY + 42);
    ctx.textAlign = 'left';
    /* 表头：模型名按列着色 */
    var LX = M + 400, nameW = nCols === 2 ? 150 : 120;
    var colW2 = (W - M - 26 - LX - nameW) / nCols;
    ctx.font = '800 24px ' + SANS;
    for (var ci = 0; ci < nCols; ci++) {
      ctx.fillStyle = COLS[ci % 3]; ctx.textAlign = 'right';
      ctx.fillText(fit(trio[ci].name, '800 24px ' + SANS, colW2 - 12), LX + nameW + (ci + 1) * colW2 - 8, PY + 96);
    }
    ctx.textAlign = 'left';
    /* 左：雷达 */
    var RX = M + 204, RCY = PY + 348, R = 146, N = DIMS.length;
    [25, 50, 75, 100].forEach(function (r) {
      ctx.beginPath();
      for (var k = 0; k < N; k++) {
        var a = (-90 + k * 360 / N) * Math.PI / 180;
        var px = RX + r / 100 * R * Math.cos(a), py = RCY + r / 100 * R * Math.sin(a);
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = r === 50 ? RED : 'rgba(23,22,15,0.14)';
      ctx.lineWidth = r === 50 ? 1.5 : 1;
      ctx.setLineDash(r === 50 ? [4, 6] : []);
      ctx.globalAlpha = r === 50 ? 0.55 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    ctx.setLineDash([]);
    for (var k = 0; k < N; k++) {
      var ang = (-90 + k * 360 / N) * Math.PI / 180;
      ctx.strokeStyle = 'rgba(23,22,15,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(RX, RCY);
      ctx.lineTo(RX + R * Math.cos(ang), RCY + R * Math.sin(ang)); ctx.stroke();
      ctx.fillStyle = SUB; ctx.font = '500 19px ' + SANS; ctx.textAlign = 'center';
      ctx.fillText(CARD_DIM_MINI[DIMS[k]], RX + (R + 19) * Math.cos(ang), RCY + (R + 19) * Math.sin(ang) + 7);
      ctx.textAlign = 'left';
    }
    function runsOf(m) {
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
    function drawPoly(m, col, lw, fill) {
      var d = runsOf(m);
      d.runs.forEach(function (run) {
        ctx.beginPath();
        run.forEach(function (r2, j) {
          var a2 = (-90 + r2 * 360 / N) * Math.PI / 180;
          var px = RX + d.vs[r2] / 100 * R * Math.cos(a2), py = RCY + d.vs[r2] / 100 * R * Math.sin(a2);
          if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        if (run.length === N) ctx.closePath();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (fill && run.length === N) { ctx.fillStyle = col; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
      });
    }
    for (var ci = nCols - 1; ci >= 1; ci--) drawPoly(trio[ci], COLS[ci % 3], 3, false);
    drawPoly(trio[0], COLS[0], 5, true);
    /* 右：名次清单（每维每模型一格，优者高亮） */
    var rowY = PY + 140, rowH = 54;
    for (var k = 0; k < N; k++) {
      var d = DIMS[k];
      ctx.fillStyle = INK; ctx.font = '600 23px ' + SANS;
      ctx.fillText(CARD_DIM[d] || d, LX, rowY);
      for (var ci = 0; ci < nCols; ci++) {
        var m = trio[ci], col = COLS[ci % 3];
        var cRight = LX + nameW + (ci + 1) * colW2 - 8;
        ctx.textAlign = 'right';
        if (has(m, d)) {
          var dr = dimRank(m, d);
          var isWin = true;
          for (var cj = 0; cj < nCols; cj++) {
            if (cj !== ci && has(trio[cj], d) && sv(trio[cj], d) > sv(m, d)) isWin = false;
          }
          ctx.globalAlpha = isWin ? 1 : 0.6;
          ctx.fillStyle = col; ctx.font = '800 25px ' + SANS;
          ctx.fillText(fmt(clamp(sv(m, d))), cRight - 62, rowY);
          ctx.fillStyle = RED; ctx.font = '700 17px ' + MONO;
          ctx.fillText('#' + dr.r + '/' + dr.n, cRight, rowY);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = SUB; ctx.font = '500 20px ' + SANS;
          ctx.fillText('待定', cRight, rowY);
        }
        ctx.textAlign = 'left';
      }
      if (k < N - 1) { ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(LX, rowY + 16); ctx.lineTo(W - M - 26, rowY + 16); ctx.stroke(); }
      rowY += rowH;
    }

    /* ── 元信息 + 页脚（左文字 · 右二维码） ── */
    var metaY = PY + PH + 34;
    ctx.fillStyle = SUB; ctx.font = '500 24px ' + SANS;
    ctx.fillText('数据覆盖：' + trio.map(function (m) { return coverage(m) + '/8'; }).join(' / ') + '　·　数据截至 ' + (String(META.built || '').slice(0, 10) || '—'), M, metaY);
    var QS = 150, qx = W - M - QS, qy = metaY - 10;
    framePanel(qx, qy, QS, QS);
    (function () {
      var n = XHS_QR.n, quiet = 3;
      var mod = (QS - 20) / (n + quiet * 2);
      var ox = qx + 10 + quiet * mod, oy = qy + 10 + quiet * mod;
      function eye(cx, cy) {
        var sz = mod * 7;
        ctx.fillStyle = INK;
        rrPath(ctx, ox + cx * mod, oy + cy * mod, sz, sz, mod * 1.8); ctx.fill();
        ctx.fillStyle = '#FFFDF8';
        rrPath(ctx, ox + (cx + 1) * mod, oy + (cy + 1) * mod, mod * 5, mod * 5, mod * 1.2); ctx.fill();
        ctx.fillStyle = INK;
        rrPath(ctx, ox + (cx + 2) * mod, oy + (cy + 2) * mod, mod * 3, mod * 3, mod * 0.9); ctx.fill();
      }
      for (var r = 0; r < n; r++) {
        var row = XHS_QR.rows[r];
        for (var cc = 0; cc < n; cc++) {
          if (row.charAt(cc) !== '1') continue;
          var inEye = (r < 7 && cc < 7) || (r < 7 && cc >= n - 7) || (r >= n - 7 && cc < 7);
          if (inEye) continue;
          ctx.fillStyle = INK;
          rrPath(ctx, ox + cc * mod + mod * 0.09, oy + r * mod + mod * 0.09, mod * 0.82, mod * 0.82, mod * 0.28);
          ctx.fill();
        }
      }
      eye(0, 0); eye(n - 7, 0); eye(0, n - 7);
    })();
    ctx.fillStyle = SUB; ctx.font = '500 18px ' + SANS; ctx.textAlign = 'center';
    ctx.fillText('扫码 · 在小红书找到我', qx + QS / 2, qy + QS + 26);
    ctx.font = '500 17px ' + MONO;
    ctx.fillText('小红书号 49224513797', qx + QS / 2, qy + QS + 48);
    ctx.textAlign = 'left';
    ctx.strokeStyle = HAIR; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(M, metaY + 34); ctx.lineTo(qx - 24, metaY + 34); ctx.stroke();
    ctx.fillStyle = SUB; ctx.font = '400 20px ' + SANS;
    ctx.fillText('分数为基准族内位次分（0-100，50＝池内中位）· 缺数据 ≠ 0 · 来源：公开榜单聚合', M, metaY + 74);
    ctx.font = '500 18px ' + MONO;
    ctx.fillText('MODEL RADAR · VOL.' + String(META.built || '').slice(0, 10), M, metaY + 104);
    var sig = (AUTHOR.name ? '@' + AUTHOR.name : '') +
              (AUTHOR.xhsId ? (AUTHOR.name ? ' · ' : '') + '小红书号 ' + AUTHOR.xhsId : '');
    if (sig) {
      ctx.font = '700 30px ' + SANS;
      var tw = ctx.measureText(sig).width;
      var avD = authorImg ? 46 : 0, gap2 = authorImg ? 14 : 0;
      var gx = W - M - QS - 24 - tw - avD - gap2;
      if (authorImg) {
        ctx.save();
        ctx.beginPath(); ctx.arc(gx + avD / 2, metaY + 96, avD / 2, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(authorImg, gx, metaY + 73, avD, avD);
        ctx.restore();
        ctx.strokeStyle = 'rgba(23,22,15,0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(gx + avD / 2, metaY + 96, avD / 2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = INK; ctx.font = '700 30px ' + SANS; ctx.textAlign = 'right';
      ctx.fillText(sig, gx - avD - gap2, metaY + 106);
      ctx.textAlign = 'left';
    }
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
    if (!gate.unlocked) { showFcta(true); toast('关注作者后可生成分享卡'); return; }
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
