/**
 * state.js
 * Estado reativo central. Padrão Observer.
 * Agora registra atividades para o feed do admin.
 */

const State = (() => {

  let _monthKey = Storage.currentMonthKey();

  let _data = {
    renda:     0,
    fixo:      [],
    caixinhas: [],
    compras:   [],
    updatedAt: null,
  };

  let _config = {};

  // ── Observer ──────────────────────────────────────────────

  const _listeners = new Set();

  function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }

  function _emit(event, payload = {}) {
    _listeners.forEach(fn => fn(event, payload));
  }

  // ── Getters ───────────────────────────────────────────────

  function getData()     { return _data; }
  function getConfig()   { return _config; }
  function getMonthKey() { return _monthKey; }

  function getCalculated() {
    const renda        = parseFloat(_data.renda) || 0;
    const totalFixo    = _sum(_data.fixo);
    const totalCaixa   = _sum(_data.caixinhas);
    const totalCompras = _sum(_data.compras);
    const totalGasto   = totalFixo + totalCaixa + totalCompras;
    const livre        = renda - totalGasto;

    return {
      renda, totalFixo, totalCaixa, totalCompras, totalGasto, livre,
      pctFixo:    renda > 0 ? (totalFixo    / renda) * 100 : 0,
      pctCaixa:   renda > 0 ? (totalCaixa   / renda) * 100 : 0,
      pctCompras: renda > 0 ? (totalCompras / renda) * 100 : 0,
      pctLivre:   renda > 0 ? Math.max(0, (livre / renda) * 100) : 100,
    };
  }

  // ── Actions ───────────────────────────────────────────────

  function loadMonth(monthKey = _monthKey) {
    _monthKey = monthKey;
    _data     = Storage.getMonthData(monthKey);
    if (!_data.lancamentos) _data.lancamentos = [];
    _config   = Storage.getConfig();
    _emit('loaded', { monthKey });
  }

  function setRenda(value) {
    const prev = _data.renda;
    _data.renda = parseFloat(value) || 0;

    if (_data.renda !== prev) {
      _log('renda', `Renda atualizada para ${_fmtBRL(_data.renda)}`, '💰');
    }

    _persist();
    _emit('updated');
  }

  function addItem(section, item) {
    if (!_data[section]) _data[section] = [];
    const newItem = {
      id:    _uid(),
      emoji: item.emoji || _defaultEmoji(section),
      name:  item.name  || 'Novo item',
      value: parseFloat(item.value) || 0,
    };
    _data[section].push(newItem);
    _log(
      `add:${section}`,
      `${newItem.emoji} ${newItem.name} — ${_fmtBRL(newItem.value)}`,
      _sectionIcon(section)
    );
    _persist();
    _emit('updated');
  }

  function updateItem(section, id, patch) {
    const idx = _data[section]?.findIndex(i => i.id === id);
    if (idx === -1 || idx === undefined) return;
    const old = { ..._data[section][idx] };
    _data[section][idx] = { ...old, ...patch };

    // Só loga mudança de valor
    if (patch.value !== undefined && patch.value !== old.value) {
      const item = _data[section][idx];
      _log(
        `update:${section}`,
        `${item.emoji} ${item.name}: ${_fmtBRL(old.value)} → ${_fmtBRL(item.value)}`,
        '✏️'
      );
    }

    _persist();
    _emit('updated');
  }

  function removeItem(section, id) {
    const item = _data[section]?.find(i => i.id === id);
    if (!item) return;
    _data[section] = _data[section].filter(i => i.id !== id);
    _log(
      `remove:${section}`,
      `${item.emoji} ${item.name} removido`,
      '🗑'
    );
    _persist();
    _emit('updated');
  }

  function saveConfig(partial) {
    Storage.saveConfig(partial);
    _config = Storage.getConfig();
    _emit('config-changed', _config);
  }

  function clearCurrentMonth() {
    Storage.clearMonthData(_monthKey);
    _data = Storage.getMonthData(_monthKey);
    _log('clear', 'Dados do mês limpos', '🗑');
    _emit('loaded', { monthKey: _monthKey });
    _emit('updated');
  }

  // ── Persist & Sync ────────────────────────────────────────

  let _persistTimer = null;

  function _persist() {
    Storage.saveMonthData(_data, _monthKey);

    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      if (navigator.onLine && SupabaseSync.isConfigured()) {
        _emit('sync-start');
        SupabaseSync.pushMonthData(_monthKey, _data).then(result => {
          _emit(result.ok ? 'sync-ok' : 'sync-error');
        });
      }
    }, 2000);
  }

  // ── Activity log ──────────────────────────────────────────

  function _log(action, detail, icon = '•') {
    SupabaseSync.logActivity(action, detail, icon);
    _emit('activity', { action, detail, icon, ts: new Date().toISOString() });
  }

  // ── Utils ─────────────────────────────────────────────────

  function _sum(list = []) {
    return list.reduce((acc, i) => acc + (parseFloat(i.value) || 0), 0);
  }

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function _defaultEmoji(section) {
    return { fixo: '💳', caixinhas: '📦', compras: '🛒' }[section] || '•';
  }

  function _sectionIcon(section) {
    return { fixo: '🔒', caixinhas: '📦', compras: '🛒' }[section] || '•';
  }

  function _fmtBRL(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  }

  // ── Lancamentos ──────────────────────────────────────────

  function addLancamento(item) {
    if (!_data.lancamentos) _data.lancamentos = [];
    // item already has id/ts from Lancamentos module
    if (!_data.lancamentos.find(l => l.id === item.id)) {
      _data.lancamentos.push(item);
    }
    const tipo = item.tipo === 'receita' ? 'Receita' : 'Despesa';
    _log(
      `add:lancamento`,
      `${tipo}: ${item.descricao} — ${_fmtBRL(item.valor)}`,
      item.tipo === 'receita' ? '📥' : '📤'
    );
    _persist();
    _emit('updated');
    _emit('lancamentos-updated');
  }

  function updateLancamento(id, patch) {
    if (!_data.lancamentos) return;
    const idx = _data.lancamentos.findIndex(l => l.id === id);
    if (idx === -1) return;
    _data.lancamentos[idx] = { ..._data.lancamentos[idx], ...patch };
    _log('update:lancamento', `Lançamento editado: ${_data.lancamentos[idx].descricao}`, '✏️');
    _persist();
    _emit('updated');
    _emit('lancamentos-updated');
  }

  function removeLancamento(id) {
    if (!_data.lancamentos) return;
    const item = _data.lancamentos.find(l => l.id === id);
    _data.lancamentos = _data.lancamentos.filter(l => l.id !== id);
    if (item) _log('remove:lancamento', `Removido: ${item.descricao}`, '🗑');
    _persist();
    _emit('updated');
    _emit('lancamentos-updated');
  }

  // ── Public API ────────────────────────────────────────────

  return {
    subscribe,
    loadMonth,
    getData, getConfig, getMonthKey, getCalculated,
    setRenda, addItem, updateItem, removeItem,
    addLancamento, updateLancamento, removeLancamento,
    saveConfig, clearCurrentMonth,
  };

})();
