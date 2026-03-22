/**
 * admin.js
 * Painel administrativo completo:
 * - Autenticação por senha
 * - Dashboard com gráficos (Chart.js via CDN)
 * - Análise detalhada + recomendações automáticas
 * - Feed de atividades Realtime
 * - Envio de mensagens para a cliente
 * - Notificações PWA push
 */

const Admin = (() => {

  let _isLoggedIn = false;
  const SESSION_KEY = 'caixinhas:admin-session';
  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // Instâncias dos gráficos (Chart.js)
  let _chartPlanejadoReal = null;
  let _chartCategorias    = null;
  let _chartDistribuicao  = null;

  // ── Auth ──────────────────────────────────────────────────

  function isLoggedIn() {
    if (_isLoggedIn) return true;
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function tryLogin(password) {
    const cfg = Storage.getConfig();
    const correct = cfg.adminPassword || 'admin';
    if (password === correct) {
      _isLoggedIn = true;
      sessionStorage.setItem(SESSION_KEY, '1');
      return true;
    }
    return false;
  }

  function logout() {
    _isLoggedIn = false;
    sessionStorage.removeItem(SESSION_KEY);
    SupabaseSync.disconnectRealtime();
    Screen.show('client');
  }

  // ── Entrar no painel ──────────────────────────────────────

  function enter() {
    Screen.show('admin');

    const monthKey = Storage.currentMonthKey();
    const [y, m] = monthKey.split('-');
    const label = new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const el = document.getElementById('admin-month-label');
    if (el) el.textContent = label.charAt(0).toUpperCase() + label.slice(1);

    _loadChartJs().then(() => {
      _renderAdminData();
    });
    _loadFeed();
    _startRealtime();
  }

  // ── Carregar Chart.js dinamicamente ──────────────────────

  function _loadChartJs() {
    return new Promise((resolve) => {
      if (window.Chart) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = resolve; // falha silenciosa — gráficos não aparecem mas app funciona
      document.head.appendChild(s);
    });
  }

  // ── Renderização dos dados ────────────────────────────────

  function _renderAdminData(data) {
    const monthKey = Storage.currentMonthKey();
    const d = data || Storage.getMonthData(monthKey);
    const renda        = parseFloat(d.renda) || 0;
    const totalFixo    = _sum(d.fixo);
    const totalCaixa   = _sum(d.caixinhas);
    const totalCompras = _sum(d.compras);
    const totalGasto   = totalFixo + totalCaixa + totalCompras;
    const livre        = renda - totalGasto;
    const pct          = renda > 0 ? ((totalGasto / renda) * 100).toFixed(1) : 0;

    // Lançamentos
    const lancs         = d.lancamentos || [];
    const totalReceitas = lancs.filter(l => l.tipo === 'receita').reduce((a, l) => a + (parseFloat(l.valor)||0), 0);
    const totalDespesas = lancs.filter(l => l.tipo === 'despesa').reduce((a, l) => a + (parseFloat(l.valor)||0), 0);
    const saldoReal     = totalReceitas - totalDespesas;
    const cobertura     = renda > 0 ? ((totalReceitas / renda) * 100).toFixed(1) : 0;

    // ── KPIs ─────────────────────────────────────────────────
    _setText('adm-renda',    fmt.format(renda));
    _setText('adm-gasto',    fmt.format(totalGasto));
    _setText('adm-pct',      `${pct}%`);
    _setText('adm-receitas', fmt.format(totalReceitas));
    _setText('adm-despesas', fmt.format(totalDespesas));
    _setText('adm-cobertura',`${cobertura}%`);

    const livreEl = document.getElementById('adm-livre');
    if (livreEl) {
      livreEl.textContent = fmt.format(livre);
      livreEl.className = 'kpi-value ' + (livre < 0 ? 'kpi-danger' : 'kpi-success');
    }

    const saldoEl = document.getElementById('adm-saldo-real');
    if (saldoEl) {
      saldoEl.textContent = fmt.format(saldoReal);
      saldoEl.className = 'kpi-value ' + (saldoReal >= 0 ? 'kpi-success' : 'kpi-danger');
    }

    // % Usado — cor dinâmica
    const pctEl = document.getElementById('adm-pct');
    if (pctEl) {
      const p = parseFloat(pct);
      pctEl.style.color = p > 100 ? 'var(--danger)' : p > 80 ? 'var(--warn)' : 'var(--text)';
    }

    // ── Barra ─────────────────────────────────────────────────
    const pctF = renda > 0 ? (totalFixo / renda) * 100 : 0;
    const pctC = renda > 0 ? ((totalCaixa + totalCompras) / renda) * 100 : 0;
    const pctL = Math.max(0, 100 - pctF - pctC);

    _setWidth('adm-bar-fixo',      `${pctF}%`);
    _setWidth('adm-bar-caixinhas', `${pctC}%`);
    _setWidth('adm-bar-livre',     `${pctL}%`);
    _setText('adm-leg-fixo',       fmt.format(totalFixo));
    _setText('adm-leg-caixinhas',  fmt.format(totalCaixa + totalCompras));
    _setText('adm-leg-livre',      fmt.format(Math.max(0, livre)));

    // ── Análise detalhada ────────────────────────────────────
    _renderAnalise({ renda, totalFixo, totalCaixa, totalCompras, totalGasto, livre,
                     totalReceitas, totalDespesas, saldoReal });

    // ── Recomendações ────────────────────────────────────────
    _renderRecomendacoes({ renda, totalGasto, livre, totalReceitas, totalDespesas,
                           saldoReal, cobertura: parseFloat(cobertura), lancs, d });

    // ── Listas ───────────────────────────────────────────────
    _renderAdminList('adm-list-fixo',      d.fixo,      'adm-total-fixo',      totalFixo);
    _renderAdminList('adm-list-caixinhas', d.caixinhas, 'adm-total-caixinhas', totalCaixa);
    _renderAdminList('adm-list-compras',   d.compras,   'adm-total-compras',   totalCompras);

    // ── Lançamentos lista ────────────────────────────────────
    Lancamentos.renderAdmin(lancs);

    // ── Gráficos ─────────────────────────────────────────────
    if (window.Chart) {
      _renderCharts({ renda, totalFixo, totalCaixa, totalCompras, livre,
                      totalReceitas, totalDespesas, lancs });
    }
  }

  // ── Análise Detalhada ────────────────────────────────────

  function _renderAnalise(nums) {
    const el = document.getElementById('adm-analise-grid');
    if (!el) return;

    const cards = [
      { label: '🟢 Renda Ativa',       val: nums.renda,          cls: '' },
      { label: '📤 Despesas Fixas',    val: nums.totalFixo,      cls: 'kpi-danger' },
      { label: '📦 Caixinhas',         val: nums.totalCaixa,     cls: '' },
      { label: '🛒 Compras',           val: nums.totalCompras,   cls: '' },
      { label: '📊 Total Comprometido',val: nums.totalGasto,     cls: nums.totalGasto > nums.renda ? 'kpi-danger' : 'kpi-warn' },
      { label: '✅ Saldo Livre',        val: nums.livre,          cls: nums.livre < 0 ? 'kpi-danger' : 'kpi-success' },
      { label: '📥 Receitas Reais',    val: nums.totalReceitas,  cls: 'kpi-success' },
      { label: '📤 Despesas Reais',    val: nums.totalDespesas,  cls: 'kpi-danger' },
      { label: '💵 Saldo Real',        val: nums.saldoReal,      cls: nums.saldoReal >= 0 ? 'kpi-success' : 'kpi-danger' },
    ];

    el.innerHTML = cards.map(c => `
      <div class="adm-analise-item">
        <div class="adm-analise-label">${c.label}</div>
        <div class="adm-analise-val ${c.cls}">${fmt.format(c.val)}</div>
      </div>
    `).join('');
  }

  // ── Recomendações automáticas ────────────────────────────

  function _renderRecomendacoes(ctx) {
    const el = document.getElementById('adm-recomendacoes-list');
    if (!el) return;

    const recs = [];
    const pctGasto = ctx.renda > 0 ? (ctx.totalGasto / ctx.renda) * 100 : 0;
    const pctCobAPassiva = ctx.renda > 0 ? (ctx.totalReceitas / ctx.renda) * 100 : 0;

    if (ctx.saldoReal > 0) {
      recs.push({ tipo: 'ok',   txt: `✓ Saldo positivo de ${fmt.format(ctx.saldoReal)}! Bom controle.` });
    } else if (ctx.saldoReal < 0) {
      recs.push({ tipo: 'danger', txt: `⚠ Saldo real negativo: ${fmt.format(ctx.saldoReal)}. Rever gastos.` });
    }

    if (ctx.cobertura < 50 && ctx.renda > 0) {
      recs.push({ tipo: 'warn', txt: `⚠ Cobertura passiva baixa (${ctx.cobertura.toFixed(1)}%) — ampliar receitas.` });
    }

    if (pctGasto > 95 && ctx.renda > 0) {
      recs.push({ tipo: 'danger', txt: `🚨 Despesas muito altas (${pctGasto.toFixed(1)}% da renda) — otimizar gastos.` });
    } else if (pctGasto > 80 && ctx.renda > 0) {
      recs.push({ tipo: 'warn', txt: `⚡ Comprometimento alto: ${pctGasto.toFixed(1)}% da renda. Cuidado!` });
    }

    if (ctx.livre > ctx.renda * 0.2 && ctx.renda > 0) {
      recs.push({ tipo: 'ok', txt: `✓ Margem livre saudável: ${fmt.format(ctx.livre)} disponíveis.` });
    }

    // Fundo de emergência ideal (3x despesas mensais)
    const fundoIdeal = ctx.totalGasto * 3;
    if (fundoIdeal > 0) {
      recs.push({ tipo: 'info', txt: `💡 Fundo de emergência ideal: ${fmt.format(fundoIdeal)} (3 meses de despesas).` });
    }

    // Top categoria de despesa
    const catMap = {};
    (ctx.lancs || []).filter(l => l.tipo === 'despesa').forEach(l => {
      catMap[l.categoria] = (catMap[l.categoria] || 0) + (parseFloat(l.valor) || 0);
    });
    const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
    if (topCat) {
      recs.push({ tipo: 'info', txt: `📊 Maior gasto: ${topCat[0]} — ${fmt.format(topCat[1])}.` });
    }

    if (ctx.renda === 0) {
      recs.push({ tipo: 'warn', txt: '⚠ Renda não informada — peça para ela atualizar.' });
    }

    if (!recs.length) {
      recs.push({ tipo: 'ok', txt: '✓ Tudo equilibrado por aqui!' });
    }

    const cls = { ok: 'adm-rec-ok', warn: 'adm-rec-warn', danger: 'adm-rec-danger', info: 'adm-rec-info', neutral: 'adm-rec-neutral' };
    el.innerHTML = recs.map(r => `<li class="adm-rec-item ${cls[r.tipo] || ''}">${_esc(r.txt)}</li>`).join('');
  }

  // ── Gráficos Chart.js ────────────────────────────────────

  function _chartDefaults() {
    return {
      color: '#999',
      borderColor: '#2a2a2a',
      plugins: {
        legend: { labels: { color: '#999', font: { family: "'DM Mono', monospace", size: 11 } } },
        tooltip: { backgroundColor: '#1e1e1e', titleColor: '#e8e8e8', bodyColor: '#999', borderColor: '#333', borderWidth: 1 },
      },
    };
  }

  function _destroyChart(ref) {
    if (ref) { try { ref.destroy(); } catch(e) {} }
    return null;
  }

  function _renderCharts({ renda, totalFixo, totalCaixa, totalCompras, livre, totalReceitas, totalDespesas, lancs }) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a78bfa';
    const success = '#34d399';
    const danger  = '#f87171';
    const warn    = '#fbbf24';
    const text2   = '#999';

    // ── Gráfico 1: Planejado vs Real (barras) ───────────────
    const canvas1 = document.getElementById('chart-planejado-real');
    if (canvas1) {
      _chartPlanejadoReal = _destroyChart(_chartPlanejadoReal);
      _chartPlanejadoReal = new Chart(canvas1, {
        type: 'bar',
        data: {
          labels: ['Renda', 'Planejado', 'Livre', 'Receitas Reais', 'Despesas Reais', 'Saldo Real'],
          datasets: [{
            label: 'R$',
            data: [renda, totalFixo + totalCaixa + totalCompras, Math.max(0, livre), totalReceitas, totalDespesas, totalReceitas - totalDespesas],
            backgroundColor: [accent + 'cc', warn + 'cc', success + 'cc', success + 'cc', danger + 'cc',
              (totalReceitas - totalDespesas) >= 0 ? success + 'cc' : danger + 'cc'],
            borderColor: [accent, warn, success, success, danger,
              (totalReceitas - totalDespesas) >= 0 ? success : danger],
            borderWidth: 1,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { ..._chartDefaults().plugins, legend: { display: false } },
          scales: {
            x: { ticks: { color: text2, font: { size: 10, family: "'DM Mono', monospace" } }, grid: { color: '#1e1e1e' } },
            y: { ticks: { color: text2, font: { size: 10, family: "'DM Mono', monospace" }, callback: (v) => 'R$' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v) }, grid: { color: '#1e1e1e' } },
          },
        },
      });
    }

    // ── Gráfico 2: Top categorias de despesa (barras horizontais) ──
    const canvas2 = document.getElementById('chart-categorias');
    if (canvas2) {
      _chartCategorias = _destroyChart(_chartCategorias);

      const catMap = {};
      lancs.filter(l => l.tipo === 'despesa').forEach(l => {
        const cat = l.categoria || 'outros';
        catMap[cat] = (catMap[cat] || 0) + (parseFloat(l.valor) || 0);
      });

      const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 7);

      if (sorted.length) {
        // Altura dinâmica — evita barras gigantes com poucos itens
        const wrap2 = canvas2.closest('.chart-wrap');
        if (wrap2) wrap2.style.height = Math.max(160, sorted.length * 38 + 40) + 'px';

        _chartCategorias = new Chart(canvas2, {
          type: 'bar',
          data: {
            labels: sorted.map(([k]) => k.charAt(0).toUpperCase() + k.slice(1)),
            datasets: [{
              label: 'Valor (R$)',
              data: sorted.map(([, v]) => v),
              backgroundColor: accent + 'bb',
              borderColor: accent,
              borderWidth: 1,
              borderRadius: 4,
              barThickness: 22,
            }],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { ..._chartDefaults().plugins, legend: { display: false } },
            scales: {
              x: { ticks: { color: text2, font: { size: 10 }, callback: (v) => 'R$' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v) }, grid: { color: '#1e1e1e' } },
              y: { ticks: { color: text2, font: { size: 10 } }, grid: { display: false } },
            },
          },
        });
      } else {
        const ctx = canvas2.getContext('2d');
        ctx.fillStyle = '#666';
        ctx.font = '12px DM Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Sem lançamentos de despesa', canvas2.width / 2, 100);
      }
    }

    // ── Gráfico 3: Distribuição do orçamento (rosca) ──────
    const canvas3 = document.getElementById('chart-distribuicao');
    if (canvas3) {
      _chartDistribuicao = _destroyChart(_chartDistribuicao);
      const livreVal = Math.max(0, livre);
      _chartDistribuicao = new Chart(canvas3, {
        type: 'doughnut',
        data: {
          labels: ['Fixo', 'Caixinhas', 'Compras', 'Livre'],
          datasets: [{
            data: [totalFixo, totalCaixa, totalCompras, livreVal],
            backgroundColor: [danger + 'cc', accent + 'cc', warn + 'cc', success + 'cc'],
            borderColor: ['#0d0d0d'],
            borderWidth: 3,
            hoverOffset: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            ..._chartDefaults().plugins,
            legend: { position: 'bottom', labels: { color: text2, font: { size: 11, family: "'DM Mono', monospace" }, padding: 14, boxWidth: 12 } },
          },
        },
      });
    }
  }

  // ── Lista somente leitura ────────────────────────────────

  function _renderAdminList(listId, items, totalId, total) {
    const el = document.getElementById(listId);
    if (!el) return;

    el.innerHTML = (!items || !items.length)
      ? '<li style="padding:12px 20px;font-size:0.8rem;color:var(--text-3)">Nenhum item</li>'
      : items.map(item => `
          <li class="item-row">
            <span class="item-emoji">${item.emoji || '•'}</span>
            <span style="flex:1;font-size:0.9rem">${_esc(item.name)}</span>
            <span style="font-family:var(--font-mono);font-size:0.88rem;color:var(--text-2)">${fmt.format(item.value)}</span>
          </li>`).join('');

    _setText(totalId, fmt.format(total));
  }

  // ── Feed de atividades ────────────────────────────────────

  function _loadFeed() {
    const local = Storage.getFeed();
    local.forEach(entry => _appendFeedItem(entry, false));

    if (!SupabaseSync.isConfigured()) return;

    SupabaseSync.fetchActivity(Storage.currentMonthKey(), 50).then(res => {
      if (!res.ok || !res.data.length) return;
      const listEl = document.getElementById('feed-list');
      if (listEl) listEl.innerHTML = '';
      res.data.forEach(row => _appendFeedItem({ action: row.action, detail: row.detail, icon: row.icon, ts: row.created_at }, false));
      const emptyEl = document.getElementById('feed-empty');
      if (res.data.length && emptyEl) emptyEl.hidden = true;
    });
  }

  function _appendFeedItem(entry, isNew = true) {
    const listEl  = document.getElementById('feed-list');
    const emptyEl = document.getElementById('feed-empty');
    const pulse   = document.getElementById('feed-pulse');

    if (!listEl) return;
    if (emptyEl) emptyEl.hidden = true;
    if (pulse)   pulse.hidden = false;

    const li = document.createElement('li');
    li.className = `feed-item${isNew ? ' feed-new' : ''}`;
    li.innerHTML = `
      <span class="feed-icon">${entry.icon || '•'}</span>
      <div class="feed-body">
        <div class="feed-text">${_esc(entry.detail || entry.action)}</div>
        <div class="feed-time">${_formatTime(entry.ts || new Date().toISOString())}</div>
      </div>`;

    listEl.prepend(li);
    if (isNew) {
      setTimeout(() => li.classList.remove('feed-new'), 4000);
      _maybePushNotification(entry);
    }

    const items = listEl.querySelectorAll('.feed-item');
    if (items.length > 80) items[items.length - 1].remove();
  }

  // ── Realtime ──────────────────────────────────────────────

  function _startRealtime() {
    if (!SupabaseSync.isConfigured()) {
      _setRealtimeStatus('not_configured');
      return;
    }

    SupabaseSync.setCallbacks({
      onMonthChange: (record) => {
        if (record.data) {
          if (window.Chart) {
            _renderAdminData(record.data);
          } else {
            _loadChartJs().then(() => _renderAdminData(record.data));
          }
          UI.toast('Dados atualizados em tempo real', 'info', 2000);
        }
      },
      onActivity: (record) => {
        _appendFeedItem({ action: record.action, detail: record.detail, icon: record.icon, ts: record.created_at }, true);
      },
      onMessage: () => {},
    });

    SupabaseSync.connectRealtime((status) => _setRealtimeStatus(status));
  }

  function _setRealtimeStatus(status) {
    const dot   = document.getElementById('realtime-dot');
    const label = document.getElementById('realtime-label');
    if (!dot) return;
    const map = {
      live:           { cls: 'live',        txt: 'ao vivo' },
      connecting:     { cls: 'connecting',  txt: 'conectando' },
      error:          { cls: 'error',       txt: 'erro' },
      not_configured: { cls: '',            txt: 'sem Supabase' },
    };
    const s = map[status] || { cls: '', txt: status };
    dot.className = `realtime-dot ${s.cls}`;
    if (label) label.textContent = s.txt;
  }

  // ── Enviar mensagem ───────────────────────────────────────

  async function sendMessage() {
    const input  = document.getElementById('admin-message-input');
    const typeEl = document.getElementById('admin-message-type');
    const text   = input?.value?.trim();
    const type   = typeEl?.value || 'info';

    if (!text) { UI.toast('Digite uma mensagem primeiro', 'warn'); return; }

    Storage.saveMessage({ text, type, ts: new Date().toISOString() });

    if (SupabaseSync.isConfigured()) {
      const result = await SupabaseSync.pushMessage(text, type);
      UI.toast(result.ok ? 'Mensagem enviada!' : 'Salvo localmente (Supabase offline)', result.ok ? 'success' : 'warn');
    } else {
      UI.toast('Mensagem salva localmente', 'info');
    }

    if (input) input.value = '';
  }

  // ── Notificações PWA ──────────────────────────────────────

  async function requestPushPermission() {
    if (!('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    const granted = result === 'granted';
    const hint = document.getElementById('push-status-hint');
    if (hint) {
      hint.textContent = granted ? '✓ Notificações ativadas!' : '✕ Permissão negada.';
      hint.style.color = granted ? 'var(--success)' : 'var(--danger)';
    }
    return granted;
  }

  function _maybePushNotification(entry) {
    const cfg = Storage.getConfig();
    if (!cfg.pushEnabled || Notification.permission !== 'granted') return;
    new Notification('Caixinhas — Atividade', {
      body: entry.detail || entry.action,
      icon: 'icon-192.png',
      tag: 'caixinhas-activity',
    });
  }

  // ── Cliente: checar mensagens do admin ────────────────────

  async function checkIncomingMessages() {
    const local = Storage.getMessage();
    if (local) { _showAlertBanner(local.text, local.type || 'info'); return; }

    if (!SupabaseSync.isConfigured()) return;
    const res = await SupabaseSync.fetchUnreadMessages();
    if (!res.ok || !res.data.length) return;
    const msg = res.data[0];
    _showAlertBanner(msg.text, msg.type || 'info');
    await SupabaseSync.markMessageRead(msg.id);
  }

  function _showAlertBanner(text, type = 'info') {
    const banner = document.getElementById('admin-alert-banner');
    const textEl = document.getElementById('admin-alert-text');
    if (!banner || !textEl) return;
    textEl.textContent = text;
    banner.className = `admin-alert-banner type-${type}`;
    const icons = { info: '💬', warn: '⚠️', success: '✅', danger: '🚨' };
    const iconEl = banner.querySelector('.admin-alert-icon');
    if (iconEl) iconEl.textContent = icons[type] || '💬';
    banner.removeAttribute('hidden');
  }

  function dismissAlert() {
    const banner = document.getElementById('admin-alert-banner');
    if (banner) banner.setAttribute('hidden', '');
    Storage.clearMessage();
  }

  // ── Utils ─────────────────────────────────────────────────

  function _sum(list = []) {
    return list.reduce((acc, i) => acc + (parseFloat(i.value) || 0), 0);
  }
  function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function _setWidth(id, val) { const el = document.getElementById(id); if (el) el.style.width = val; }
  function _esc(str) { return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _formatTime(isoStr) {
    try {
      const d = new Date(isoStr);
      const diffMin = Math.floor((new Date() - d) / 60000);
      if (diffMin < 1)  return 'agora';
      if (diffMin < 60) return `há ${diffMin}min`;
      if (diffMin < 1440) return `há ${Math.floor(diffMin/60)}h`;
      return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
    } catch { return '—'; }
  }

  // ── Public API ────────────────────────────────────────────

  return {
    isLoggedIn, tryLogin, logout, enter,
    sendMessage, requestPushPermission,
    checkIncomingMessages, dismissAlert,
    renderAdminData: _renderAdminData,
  };

})();

// ── Screen manager ────────────────────────────────────────

const Screen = (() => {
  const screens = ['login', 'client', 'admin'];
  function show(name) {
    screens.forEach(s => {
      const el = document.getElementById(`screen-${s}`);
      if (el) {
        if (s === name) el.removeAttribute('hidden');
        else el.setAttribute('hidden', '');
      }
    });
  }
  return { show };
})();
