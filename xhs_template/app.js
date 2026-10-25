/* ═══ 模型雷达 · 小红书竖屏版 JS ═══
   五层：数据接入 / 纯计算 / 状态深链 / 渲染 / 事件。ES2017 上限，无内联事件。 */
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
  var MODEL_IX = {}; ALL.forEach(function (m) { MODEL_IX[m.name] = m; });
  var EVIDX = {};
  EV.forEach(function (e) {
    var k = e.m + '||' + e.d;
    (EVIDX[k] = EVIDX[k] || []).push(e);
  });
  var SCENE_HINT = {
    '自媒体内容运营': '写文案、起标题、做脚本', 'Agent与工作流': '调工具、跑多步任务',
    '代码开发': '写代码、改 bug、审代码', 'RAG知识问答': '检索问答与摘要', '日常综合': '问答、写作、分析'
  };
  var COLORS = ['#D93A1E', '#1B5FE0', '#0C8438'];
  var MAX_SELECT = 3, TIE = 2, LOW_COV = 0.6;
  var ALIAS_FIRST = true;   // 竖屏窄宽：轴标签优先用白话别名

  /* ── 2. 纯计算 ───────────────────────────────────────────────── */
  var state = { scene: SCENES[0].name, scope: 'all', selected: [], tab: 'rank',
                q: '', hidePending: false, more: false, sheet: null };

  function scopeScores(m) {
    if (state.scope === 'tp' && m.scoresTp) return m.scoresTp;
    if (state.scope === 'inf' && m.scoresInf) return m.scoresInf;
    return m.scores;
  }
  function singlesOf(m) {
    if (!m) return {};
    if (state.scope === 'tp' && m.scoresTp) return m.sfTp || {};
    return m.sf || {};
  }
  function sv(m, d) {
    var v = m ? scopeScores(m)[d] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : undefined;
  }
  function has(m, d) { return sv(m, d) !== undefined; }
  function evsOf(name, d) {
    var list = EVIDX[name + '||' + d] || [];
    return state.scope === 'tp' ? list.filter(function (e) { return !e.vend && !e.inf; }) : list;
  }
  function isInf(m, d) {
    if (state.scope !== 'inf' || !m.scoresInf || !(d in m.scoresInf)) return false;
    return !evsOf(m.name, d).some(function (e) { return !e.inf && e.fam && e.famN >= 2; });
  }
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
    return visible().map(function (m) { return { m: m, c: composite(m, scene) }; })
      .filter(function (r) { return coverage(r.m) > 0; })
      .sort(function (a, b) { return b.c - a.c; });
  }
  function dimLabel(d) { return (ALIAS_FIRST && DIM_ALIAS[d]) ? DIM_ALIAS[d] : d; }
  function dimSub(d) { return (ALIAS_FIRST && DIM_ALIAS[d]) ? d : (DIM_ALIAS[d] || ''); }

  /* ── 3. 状态工具 ─────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var fmt = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
  var clamp = function (v) { return Math.max(0, Math.min(100, v)); };

  function toggleSelect(name) {
    var i = state.selected.indexOf(name);
    if (i >= 0) state.selected.splice(i, 1);
    else {
      if (state.selected.length >= MAX_SELECT) return flash('最多同时对比 ' + MAX_SELECT + ' 个');
      state.selected.push(name);
    }
    syncHash(); renderAll();
  }
  function setTab(t) {
    state.tab = t;
    ['rank', 'cmp', 'about'].forEach(function (x) {
      $('view-' + x).hidden = x !== t;
      var b = document.querySelector('#tabbar button[data-t="' + x + '"]');
      if (b) b.className = x === t ? 'on' : '';
    });
    syncHash();
    if (t === 'cmp') { renderCmpChips(); renderRadar(); renderDimCmp(); renderSceneTake(); renderCmpTip(); }
    if (t === 'rank') renderRank();
  }
  function setScope(s) {
    if (state.scope === s) return;
    state.scope = s;
    POOL = {};
    [...$('scope').children].forEach(function (x) { x.className = x.getAttribute('data-s') === s ? 'on' : ''; });
    syncHash(); renderAll();
  }
  function syncHash() {
    var h = 'scene=' + encodeURIComponent(state.scene);
    state.selected.forEach(function (n) { h += '&model=' + encodeURIComponent(n); });
    if (state.scope !== 'all') h += '&scope=' + state.scope;
    if (state.tab !== 'rank') h += '&tab=' + state.tab;
    try { history.replaceState(null, '', '#' + h); } catch (e) { location.hash = h; }
  }
  function readHash() {
    try {
      decodeURIComponent((location.hash || '').replace(/^#/, '')).split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0] === 'scene' && sceneByName(p[1]).name === p[1]) state.scene = p[1];
        else if (p[0] === 'model' && p[1] && MODEL_IX[p[1]] && state.selected.indexOf(p[1]) < 0 && state.selected.length < MAX_SELECT) state.selected.push(p[1]);
        else if (p[0] === 'scope' && ['all', 'tp', 'inf'].indexOf(p[1]) >= 0) state.scope = p[1];
        else if (p[0] === 'tab' && ['rank', 'cmp', 'about'].indexOf(p[1]) >= 0) state.tab = p[1];
      });
    } catch (e) {}
  }
  function openSheet(kind, a, b) {
    state.sheet = kind + '|' + (a || '') + '|' + (b || '');
    if (kind === 'dim') renderDimSheet(a, b);        // a=模型名|null b=维度
    else if (kind === 'model') renderModelSheet(a);   // a=模型名
    $('sheet').classList.add('on');
    $('sheet-scrim').classList.add('on');
    $('sheet').setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    state.sheet = null;
    $('sheet').classList.remove('on');
    $('sheet-scrim').classList.remove('on');
    $('sheet').setAttribute('aria-hidden', 'true');
  }
  function flash(msg) { $('cmp-tip').textContent = msg; $('cmp-tip').style.color = 'var(--signal)'; setTimeout(function () { renderCmpTip(); }, 2200); }

  /* ── 4. 渲染 ─────────────────────────────────────────────────── */
  var POOL = {};
  function pool(d) {
    if (!POOL[d]) {
      var v = ALL.filter(function (m) { return has(m, d); }).map(function (m) { return sv(m, d); });
      POOL[d] = v.length ? { n: v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v) } : { n: 0, min: 0, max: 0 };
    }
    return POOL[d];
  }
  function poolPos(d, val) {
    var p = pool(d);
    if (!p.n || p.max === p.min) return 50;
    return clamp((val - p.min) / (p.max - p.min) * 100);
  }
  function distRow(name, val, i, hl, d) {
    var r = el('div', 'dist');
    r.appendChild(el('span', 'nm', '#' + i + ' ' + name));
    var b = el('span', 'b');
    var fi = document.createElement('i');
    var p = d ? pool(d) : null;
    fi.style.width = (p && p.max !== p.min ? clamp((parseFloat(val) - p.min) / (p.max - p.min) * 100) : 50) + '%';
    b.appendChild(fi); r.appendChild(b);
    r.appendChild(el('span', 'v', val));
    if (hl) r.style.background = 'var(--signal-2)';
    return r;
  }

  function renderStrip() {
    var box = $('scene-strip'); box.textContent = '';
    SCENES.forEach(function (s, i) {
      var b = el('button', s.name === state.scene ? 'on' : '');
      b.appendChild(el('i', '', String(i + 1).length < 2 ? '0' + (i + 1) : String(i + 1)));
      b.appendChild(document.createTextNode(s.name));
      b.addEventListener('click', function () { state.scene = s.name; syncHash(); renderAll(); });
      box.appendChild(b);
    });
  }

  function renderVerdict() {
    var box = $('verdict'); box.textContent = '';
    var top = ranked().slice(0, 3);
    var scene = sceneByName(state.scene), w = W();
    if (top.length) {
      var t = el('div', 'vd-top');
      t.appendChild(el('span', 'n', '#1'));
      t.appendChild(el('b', '', top[0].m.name));
      t.appendChild(el('span', 's num', fmt(top[0].c)));
      t.title = coverage(top[0].m) + '/8 维 · 位次分不是考试分';
      t.style.cursor = 'pointer';
      t.addEventListener('click', function () { openSheet('model', top[0].m.name); });
      box.appendChild(t);
      var why = el('div', 'vd-why');
      var m0 = top[0].m;
      var picks = DIMS.filter(function (d) { return has(m0, d); })
        .sort(function (a, b) { return (w[b] || 0) - (w[a] || 0); }).slice(0, 2);
      why.innerHTML = '<b>先看 ' + m0.name + '</b>：' + picks.map(function (d) {
        return dimLabel(d) + ' 权重 ' + Math.round(w[d] || 0) + '%，排 #' + dimRank(d, m0);
      }).join('；') + '。' + (SCENE_HINT[scene.name] ? '场景＝' + SCENE_HINT[scene.name] + '。' : '');
      box.appendChild(why);
      var cTop = coverage(m0);
      if (cTop < 6) {
        box.appendChild(el('div', 'vd-warn', '⚠ 首选仅 ' + cTop + '/8 维有证据：缺维权重已让位，名次仅供参考'));
      }
      if ((w['内容创作'] || 0) >= 20) {
        box.appendChild(el('div', 'vd-warn', '⚠ 内容创作维以英文写作为主，中文选型建议先试稿'));
      }
    }
    var blanks = ALL.length * 8 - ALL.reduce(function (s, m) { return s + coverage(m); }, 0);
    box.appendChild(el('div', 'vd-meta',
      (state.scope === 'all' ? '全部来源' : state.scope === 'tp' ? '仅第三方' : '含推理补全') +
      ' 口径 · ' + scene.name + ' · ' + blanks + ' 格待定（缺数据 ≠ 0 分）'));
  }

  function renderCards() {
    var box = $('cards'); box.textContent = '';
    var rows = ranked();
    var show = state.more ? rows : rows.slice(0, 15);
    show.forEach(function (r, i) {
      var m = r.m, sel = state.selected.indexOf(m.name), selIdx = sel >= 0 ? sel : -1;
      var card = el('div', 'card' + (sel >= 0 ? ' on' : ''));
      if (selIdx >= 0) card.style.setProperty('--row-c', COLORS[selIdx % 3]);
      card.setAttribute('data-model', m.name);
      var hd = el('div', 'card-hd');
      hd.appendChild(el('span', 'rk num', String(i + 1)));
      hd.appendChild(el('span', 'nm', m.name));
      if (m.company) hd.appendChild(el('span', 'co', m.company));
      hd.appendChild(el('span', 'val num', fmt(r.c)));
      card.appendChild(hd);
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
        covN + '/8 维' + (low ? ' · 低覆盖' : '') + (singlesOf(m) && Object.keys(singlesOf(m)).length ? ' · †' : '') +
        ' · ' + (m.company || ''));
      var cmp = el('button', 'cmpbtn' + (sel >= 0 ? ' on' : ''), sel >= 0 ? '✓ 对比中' : '＋ 对比');
      cmp.addEventListener('click', function (ev) {
        ev.stopPropagation(); toggleSelect(m.name);
      });
      meta.appendChild(cmp);
      card.appendChild(meta);
      /* 点卡片主体 → 展开逐维明细 */
      var detail = el('div', 'card-detail');
      detail.hidden = state.expanded !== m.name;
      DIMS.forEach(function (d) {
        var row = el('div', 'drow' + (has(m, d) ? '' : ' miss') + (isInf(m, d) ? ' inf' : ''));
        var dl = el('div', 'dl');
        dl.appendChild(el('i', '', '›'));
        dl.appendChild(document.createTextNode(' ' + dimLabel(d)));
        dl.title = d + '：' + (DIM_DESC[d] || '');
        dl.addEventListener('click', function () { openSheet('dim', m.name, d); });
        row.appendChild(dl);
        var db = el('div', 'db');
        if (has(m, d)) {
          var fi = document.createElement('i');
          fi.style.width = clamp(poolPos(d, sv(m, d))) + '%';
          db.appendChild(fi);
        }
        row.appendChild(db);
        var dv = el('div', 'dv num');
        if (!has(m, d)) dv.textContent = '待定';
        else dv.textContent = fmt(sv(m, d)) + (singlesOf(m)[d] ? ' †' : '') + (isInf(m, d) ? ' 推' : '') + ' #' + dimRank(d, m);
        row.appendChild(dv);
        detail.appendChild(row);
      });
      card.appendChild(detail);
      /* 点卡片头 = 展开/收起明细 */
      hd.addEventListener('click', function () {
        state.expanded = state.expanded === m.name ? null : m.name;
        detail.hidden = state.expanded !== m.name;
      });
      box.appendChild(card);
    });
    if (!rows.length) box.appendChild(el('div', 'card', '没有匹配的模型'));
    $('btn-more').textContent = state.more ? '收起' : '展开全部 ' + rows.length + ' 个';
  }

  function renderRadar() {
    var svg = $('radar'); svg.textContent = '';
    var NS = 'http://www.w3.org/2000/svg';
    var CX = 170, CY = 142, R = 104, N = DIMS.length;
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
      add('path', { d: d + 'Z', fill: 'none', stroke: r === 100 ? '#A79F8B' : '#DCD6C6',
                    'stroke-width': r === 100 ? 1.1 : 1, 'stroke-dasharray': r === 100 ? 'none' : '1.5 3.5' });
    });
    var missAny = DIMS.map(function (d) {
      return state.selected.some(function (n) { var mm = MODEL_IX[n]; return mm && !has(mm, d); });
    });
    for (var i = 0; i < N; i++) {
      var p = pt(i, 100);
      add('line', { x1: CX, y1: CY, x2: p[0], y2: p[1], stroke: '#E7E2D5', 'stroke-width': 1 });
      add('circle', missAny[i]
        ? { cx: p[0], cy: p[1], r: 3, fill: '#FAF8F3', stroke: '#A79F8B', 'stroke-width': 1, 'stroke-dasharray': '2 2' }
        : { cx: p[0], cy: p[1], r: 1.8, fill: '#FAF8F3', stroke: '#A79F8B', 'stroke-width': 1 });
    }
    add('circle', { cx: CX, cy: CY, r: 1.5, fill: '#A79F8B' });
    [40, 80].forEach(function (r) {
      var y = CY - r / 100 * R;
      add('line', { x1: CX - 3, y1: y, x2: CX + 3, y2: y, stroke: '#C3BCAA', 'stroke-width': 1 });
      add('text', { x: CX + 6, y: y + 3, 'font-size': 7.5, fill: '#B0A995',
                    'font-family': 'ui-monospace,Consolas,monospace' }, String(r));
    });
    /* 轴标签：白话优先 + 可点 */
    for (i = 0; i < N; i++) {
      var a = (-90 + i * 360 / N) * Math.PI / 180;
      var lx = CX + (R + 20) * Math.cos(a), ly = CY + (R + 20) * Math.sin(a) + 3;
      var anchor = Math.abs(Math.cos(a)) < 0.35 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      var tg = document.createElementNS(NS, 'g');
      tg.setAttribute('class', 'ax-tag'); tg.setAttribute('data-dim', DIMS[i]);
      var tt = document.createElementNS(NS, 'text');
      tt.setAttribute('x', lx); tt.setAttribute('y', ly); tt.setAttribute('text-anchor', anchor);
      tt.setAttribute('class', 'lbl');
      tt.appendChild(document.createTextNode(dimLabel(DIMS[i])));
      var sfx = '';
      state.selected.forEach(function (n) {
        var mm = MODEL_IX[n];
        if (mm && singlesOf(mm)[DIMS[i]]) sfx = mm.name;
      });
      if (sfx) {
        var t3 = document.createElementNS(NS, 'tspan');
        t3.setAttribute('dx', 2); t3.setAttribute('class', 'sfx'); t3.textContent = '†';
        tt.appendChild(t3);
        var ttl = document.createElementNS(NS, 'title');
        ttl.textContent = '† ' + sfx + ' 在这一维只有 1 个基准族支撑';
        tg.appendChild(ttl);
      }
      tg.appendChild(tt);
      svg.appendChild(tg);
      var hit = add('line', { x1: CX, y1: CY, x2: pt(i, 100)[0], y2: pt(i, 100)[1],
                              stroke: 'transparent', 'stroke-width': 13, style: 'cursor:pointer' });
      hit.setAttribute('data-dim', DIMS[i]);
    }
    /* 折线：缺维断口（红线）+ 顶点 + 推理空心圈 */
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
          add('circle', { cx: p1[0], cy: p1[1], r: 2.6, fill: c, stroke: '#FAF8F3', 'stroke-width': 1 });
          return;
        }
        var d = '';
        run.forEach(function (kk, j) {
          var pp = pt(kk, vs[kk]);
          d += (j ? 'L' : 'M') + pp[0].toFixed(1) + ' ' + pp[1].toFixed(1);
        });
        var full = run.length === N;
        if (full) d += 'Z';
        add('path', { d: d, fill: full ? c : 'none', 'fill-opacity': full && idx === 0 ? .13 : 0,
                      stroke: c, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        run.forEach(function (kk) {
          var pv = pt(kk, vs[kk]);
          add('circle', { cx: pv[0], cy: pv[1], r: 2.6, fill: c, stroke: '#FAF8F3', 'stroke-width': 1 });
        });
      });
      DIMS.forEach(function (d, i3) {
        if (!isInf(m, d)) return;
        var pc = pt(i3, vs[i3] !== null ? vs[i3] : 0);
        add('circle', { cx: pc[0], cy: pc[1], r: 3.2, fill: '#FAF8F3', stroke: c,
                        'stroke-width': 1.4, 'stroke-dasharray': '2 2' });
      });
    });
    /* 图例 */
    var lg = $('radar-legend'); lg.textContent = '';
    if (!state.selected.length) lg.appendChild(el('span', '', '在「榜单」点 ＋ 对比 选 1~3 个'));
    state.selected.forEach(function (n) {
      var it = el('span', '', n);
      var i = el('i'); i.style.background = COLORS[state.selected.indexOf(n) % 3];
      it.insertBefore(i, it.firstChild);
      it.appendChild(el('span', '', ' ' + coverage(MODEL_IX[n]) + '/8'));
      lg.appendChild(it);
    });
  }

  function renderDimCmp() {
    var box = $('dimcmp'); box.textContent = '';
    var w = W();
    if (!state.selected.length) return;
    DIMS.forEach(function (d) {
      var vals = state.selected.map(function (n) { return MODEL_IX[n]; })
        .filter(function (m) { return has(m, d); })
        .map(function (m) { return { n: m.name, v: sv(m, d) }; })
        .sort(function (a, b) { return b.v - a.v; });
      var bestV = vals.length ? vals[0].v : null;
      var mg = vals.length > 1 ? vals[0].v - vals[1].v : null;
      var tie = mg !== null && mg < TIE;
      var row = el('div', 'dimrow');
      var dt = el('div', 'dt');
      dt.appendChild(el('b', '', dimLabel(d)));
      if (dimSub(d)) dt.appendChild(el('span', 'w', dimSub(d)));
      dt.appendChild(el('span', 'w', '权重 ' + Math.round(w[d] || 0) + '%'));
      var hasSf = state.selected.some(function (n) { var mm = MODEL_IX[n]; return mm && singlesOf(mm)[d]; });
      if (hasSf) { var sf = el('span', 'sfb', '†'); sf.title = '单基准：仅 1 个基准族支撑'; dt.appendChild(sf); }
      row.appendChild(dt);
      var cells = el('div', 'cells');
      state.selected.forEach(function (n) {
        var m = MODEL_IX[n];
        var cell = el('div', 'cell');
        var isWin = vals.length > 1 && !tie && bestV !== null && has(m, d) && sv(m, d) === bestV;
        if (isWin) cell.className += ' win';
        cell.appendChild(el('div', 'cn', n));
        if (!has(m, d)) { cell.className += ' miss'; cell.appendChild(el('div', 'cv', '待定')); }
        else {
          cell.appendChild(el('div', 'cv num', fmt(sv(m, d)) + (singlesOf(m)[d] ? ' †' : '')));
          cell.appendChild(el('div', 'cr', '#' + dimRank(d, m) + '/' + pool(d).n));
        }
        cells.appendChild(cell);
      });
      row.appendChild(cells);
      if (tie) { row.appendChild(el('div', 'tie', '≈平（差距 <2 分，噪声级）')); }
      box.appendChild(row);
    });
  }

  function renderSceneTake() {
    var box = $('scenetake'); box.textContent = '';
    if (state.selected.length < 2) return;
    box.appendChild(el('div', 'about-sec', '')).parentNode; /* 占位不需要 */
    box.textContent = '';
    var h = el('h3', '', '场景取舍（差 <2 分 ≈平）');
    h.style.cssText = 'margin:0 0 6px;font:400 10px var(--f-mono);letter-spacing:.14em;color:var(--ink-3);text-transform:uppercase';
    box.appendChild(h);
    SCENES.forEach(function (s) {
      var vals = state.selected.map(function (n) { return MODEL_IX[n]; })
        .filter(function (m) { return coverage(m) > 0; })
        .map(function (m) { return { n: m.name, v: composite(m, s), r: sceneRank(s, m) }; })
        .sort(function (a, b) { return b.v - a.v; });
      var mg = vals.length > 1 ? vals[0].v - vals[1].v : null;
      var row = el('div', 'strow' + (s.name === state.scene ? ' cur' : ''));
      row.appendChild(el('span', 'sn', s.name));
      var sv2 = el('span', 'sv');
      if (!vals.length) sv2.textContent = '都没分';
      else if (vals.length === 1) sv2.textContent = '仅 ' + vals[0].n + ' 有分 #' + vals[0].r;
      else if (mg < TIE) sv2.textContent = vals.map(function (x) { return x.n; }).join(' ≈ ') + '（+' + fmt(mg) + '）';
      else { sv2.innerHTML = '<b>' + vals[0].n + '</b> 领先 +' + fmt(mg) + '（#' + vals[0].r + '）'; }
      row.appendChild(sv2);
      box.appendChild(row);
    });
  }

  function renderCmpTip() {
    var tip = $('cmp-tip');
    if (state.selected.length === 0) tip.textContent = '去「榜单」点卡片右上角 ＋ 对比，选 1~3 个模型';
    else if (state.selected.length === 1) tip.textContent = '已选 1 个：再加 1–2 个模型即可逐维对比';
    else tip.textContent = '已选 ' + state.selected.length + ' 个 · 点维度行看证据，点轴标签看维度详解';
    tip.style.color = '';
  }
  function renderCmpChips() {
    var box = $('cmp-chips'); box.textContent = '';
    state.selected.forEach(function (n, i) {
      var c = el('div', 'chip');
      var dot = el('i'); dot.style.background = COLORS[i % 3];
      c.appendChild(dot); c.appendChild(el('b', '', n));
      var x = el('span', 'x', '✕'); x.title = '移出对比';
      x.addEventListener('click', function (ev) { ev.stopPropagation(); toggleSelect(n); });
      c.appendChild(x);
      box.appendChild(c);
    });
    if (state.selected.length && state.selected.length < MAX_SELECT) {
      var add = el('button', 'add', '+ 去榜单添加');
      add.addEventListener('click', function () { setTab('rank'); });
      box.appendChild(add);
    }
  }

  /* ── Sheet：模型详情 / 维度证据 ───────────────────────────────── */
  function renderModelSheet(name) {
    var m = MODEL_IX[name]; if (!m) return;
    var scene = sceneByName(state.scene);
    $('sh-title').textContent = m.name;
    $('sh-sub').textContent = (m.company || '') + ' · ' + scene.name + ' 综合 ' +
      fmt(composite(m, scene)) + ' · ' + coverage(m) + '/8 维';
    var body = $('sh-body'); body.textContent = '';
    if (m.note) {
      var mn = el('div', 'mnote'); mn.appendChild(el('b', '', '备注 ')); mn.appendChild(document.createTextNode(m.note));
      body.appendChild(mn);
    }
    body.appendChild(el('h3', '', '本场景 8 维'));
    DIMS.forEach(function (d) {
      var row = el('div', 'dd').appendChild(el('div', 'rw'));
      row.appendChild(el('span', 'k', dimLabel(d) + ' · ' + Math.round(W()[d] || 0) + '%'));
      var v = el('span', 'v');
      if (!has(m, d)) v.textContent = '待定（权重让位）';
      else {
        v.textContent = fmt(sv(m, d)) + ' · #' + dimRank(d, m) + '/' + pool(d).n +
          (singlesOf(m)[d] ? ' · † 单基准' : '') + (isInf(m, d) ? ' · 推理值' : '');
      }
      row.appendChild(v);
      body.appendChild(row);
    });
    body.appendChild(el('h3', '', '本场景排名'));
    ranked().slice(0, 20).forEach(function (r, i) {
      body.appendChild(distRow(r.m.name, fmt(r.c), i + 1, r.m.name === m.name, null));
    });
    body.appendChild(el('h3', '', '口径'));
    body.appendChild(el('div', 'fact', '综合分 = Σ(维度分 × 权重) ÷ Σ(权重)，缺维权重让位。维度分为位次分（相对站位），详见「关于」。'));
  }

  function renderDimSheet(modelName, dim) {
    var m = modelName ? MODEL_IX[modelName] : null;
    $('sh-title').textContent = (m ? m.name + ' · ' : '') + dim;
    var w = W()[dim] || 0;
    $('sh-sub').textContent = (DIM_ALIAS[dim] ? DIM_ALIAS[dim] + ' · ' : '') +
      '权重 ' + Math.round(w) + '% · 池内 ' + pool(dim).n + ' 个模型有分' +
      (m && has(m, dim) ? ' · 名次 #' + dimRank(dim, m) : '');
    var body = $('sh-body'); body.textContent = '';
    body.appendChild(el('h3', '', '这个维度是什么'));
    body.appendChild(el('div', 'fact', DIM_DESC[dim] || ''));
    var dinfo = DIM_INFO[dim] || {};
    if (dinfo.plain) body.appendChild(el('div', 'fact', dinfo.plain));
    if (dinfo.tasks || dinfo.advice || dinfo.sources) {
      var dd = el('div', 'dd');
      [['常见任务', dinfo.tasks], ['何时重点看', dinfo.advice], ['常见基准', dinfo.sources]].forEach(function (x) {
        if (!x[1]) return;
        var rw = el('div', 'rw');
        rw.appendChild(el('span', 'k', x[0]));
        rw.appendChild(el('span', 'v', x[1]));
        dd.appendChild(rw);
      });
      body.appendChild(dd);
    }
    if (m) {
      var evs = evsOf(m.name, dim);
      var nScored = evs.filter(function (e) { return (e.fam && e.famN >= 2) || (e.inf && state.scope === 'inf'); }).length;
      body.appendChild(el('h3', '', '分数怎么来的（计分 ' + nScored + ' 条）'));
      if (m.note) {
        var mn = el('div', 'mnote'); mn.appendChild(el('b', '', '备注 ')); mn.appendChild(document.createTextNode(m.note));
        body.appendChild(mn);
      }
      if (!evs.length) {
        body.appendChild(el('div', 'fact',
          '该模型在这一维没有可用证据 → 页面按「待定」处理，综合分里权重让位（不是 0 分）。'));
      }
      evs.forEach(function (e) {
        var evb = el('div', 'ev' + (e.inf ? ' inf' : ''));
        var r1 = el('div', 'r1');
        r1.appendChild(el('span', 'src', e.src));
        r1.appendChild(el('span', 'val', e.val === null ? '—' : fmt(e.val)));
        evb.appendChild(r1);
        evb.appendChild(el('div', 'cat', e.cat));
        evb.appendChild(el('div', 'meta', '原始 ' + e.raw + '（' + e.scale + '）@' + e.date +
          (e.fam ? ' · 基准族 ' + e.fam + '（n=' + e.famN + (e.famN >= 2 ? '，权重×' + e.w : '，不计分') + '）' : '') +
          (e.inf && e.basis ? ' · 依据：' + e.basis : '') +
          (e.inf && e.loeoMAE ? ' · 留一MAE ' + e.loeoMAE : '') +
          (e.url ? ' · ' + e.url : '')));
        body.appendChild(evb);
      });
    }
    body.appendChild(el('h3', '', '同维 · 池内分布'));
    ALL.filter(function (o) { return has(o, dim); })
      .sort(function (a, b) { return sv(b, dim) - sv(a, dim); })
      .slice(0, 12)
      .forEach(function (o, i) { body.appendChild(distRow(o.name, fmt(sv(o, dim)), i + 1, m && o.name === m.name, dim)); });
  }

  function renderAbout() {
    var box = $('about-data-body'); box.textContent = '';
    box.appendChild(el('div', 'mono',
      '数据截至 ' + (META.built || '') + ' · ' + (META.models || '') + ' · ' + (META.sources || '')));
    box.appendChild(el('div', 'mono', META.disclaimer || ''));
    box.appendChild(el('div', 'mono', 'GitHub 开源版：github.com/Brando-2077/model-radar（代码 MIT / 数据 CC BY 4.0）'));
  }

  function renderAll() {
    renderStrip(); renderVerdict(); renderCards();
    if (state.tab === 'cmp') { renderCmpChips(); renderRadar(); renderDimCmp(); renderSceneTake(); renderCmpTip(); }
    renderAbout();
    $('hd-sub').textContent = META.built + ' · ' + DIMS.length + ' 维 · ' + ALL.length + ' 模型';
    syncHash();
  }

  /* ── 5. 事件 ─────────────────────────────────────────────────── */
  $('scope').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    setScope(b.getAttribute('data-s'));
  });
  $('tabbar').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    setTab(b.getAttribute('data-t'));
  });
  $('q').addEventListener('input', function (ev) {
    state.q = ev.target.value;
    $('q-clear').hidden = !state.q;
    renderVerdict(); renderCards();
  });
  $('q-clear').addEventListener('click', function () {
    $('q').value = ''; state.q = ''; $('q-clear').hidden = true;
    renderVerdict(); renderCards();
  });
  $('hide-pending').addEventListener('change', function () {
    state.hidePending = this.checked; renderVerdict(); renderCards();
  });
  $('btn-more').addEventListener('click', function () { state.more = !state.more; renderCards(); });
  $('sh-close').addEventListener('click', closeSheet);
  $('sheet-scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSheet(); });
  /* 点维度行（对比 tab 的 dimrow 标题 / 榜单明细 dl 已单独绑）→ 维度 sheet */
  $('dimcmp').addEventListener('click', function (ev) {
    var t = ev.target.closest('.dt b'); if (!t) return;
    var d = DIMS.find(function (x) { return dimLabel(x) === t.textContent || x === t.textContent; });
    if (d) openSheet('dim', state.selected[0] ? state.selected[0] : null, d);
  });
  document.body.addEventListener('click', function (ev) {
    var s = ev.target.closest && ev.target.closest('.sheet'); if (s) return;
    /* 空白处关闭 sheet 由 scrim 处理 */
  });

  /* ── 启动 ────────────────────────────────────────────────────── */
  readHash();
  [...$('scope').children].forEach(function (x) { x.className = x.getAttribute('data-s') === state.scope ? 'on' : ''; });
  renderAll();
  setTab(state.tab);
})();
