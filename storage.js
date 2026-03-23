/**
 * storage.js
 * Abstração localStorage. Toda leitura/escrita de dados passa por aqui.
 * Inclui flag de sincronização pendente para funcionalidade offline.
 */

const Storage = (() => {

  const KEYS = {
    CONFIG:       'caixinhas:config',
    DATA:         (k) => `caixinhas:data:${k}`,
    HISTORY:      'caixinhas:history',
    MESSAGES:     'caixinhas:messages',
    FEED:         'caixinhas:feed',
    PENDING_SYNC: 'caixinhas:pending-sync',
  };

  // ── Helpers ───────────────────────────────────────────────

  function safeGet(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[Storage] Falha ao salvar:', key, e);
      return false;
    }
  }

  // ── Config ────────────────────────────────────────────────

  const DEFAULT_CONFIG = {
    appName:       'Caixinhas',
    userName:      '',
    userId:        'usuario',
    accentColor:   '#a78bfa',
    adminPassword: 'admin',
    supabaseUrl:   '',
    supabaseKey:   '',
    pushEnabled:   false,
    pushSubscription: null,
    sectionNames: {
      fixo:      'Não pode gastar',
      caixinhas: 'Caixinhas',
      compras:   'O que preciso comprar',
    },
    sectionDescs: {
      fixo:      'Compromissos e despesas fixas do mês',
      caixinhas: 'Metas e reservas do mês',
      compras:   'Itens planejados para adquirir',
    },
  };

  function getConfig() {
    return { ...DEFAULT_CONFIG, ...safeGet(KEYS.CONFIG, {}) };
  }

  function saveConfig(partial) {
    const current = getConfig();
    return safeSet(KEYS.CONFIG, { ...current, ...partial });
  }

  // ── Month ─────────────────────────────────────────────────

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const DEFAULT_MONTH = {
    renda:        0,
    fixo:         [],
    caixinhas:    [],
    compras:      [],
    lancamentos:  [],
    updatedAt:    null,
  };

  function getMonthData(monthKey = currentMonthKey()) {
    return { ...DEFAULT_MONTH, ...safeGet(KEYS.DATA(monthKey), {}) };
  }

  function saveMonthData(data, monthKey = currentMonthKey()) {
    const toSave = { ...data, updatedAt: new Date().toISOString() };
    const ok = safeSet(KEYS.DATA(monthKey), toSave);
    if (ok) _updateHistory(monthKey, toSave);
    return ok;
  }

  function clearMonthData(monthKey = currentMonthKey()) {
    localStorage.removeItem(KEYS.DATA(monthKey));
  }

  // ── History ───────────────────────────────────────────────

  function _updateHistory(monthKey, data) {
    const history = safeGet(KEYS.HISTORY, {});
    history[monthKey] = {
      renda:        data.renda,
      totalFixo:    _sum(data.fixo),
      totalCaixa:   _sum(data.caixinhas),
      totalCompras: _sum(data.compras),
      updatedAt:    data.updatedAt,
    };
    safeSet(KEYS.HISTORY, history);
  }

  function getHistory() {
    return safeGet(KEYS.HISTORY, {});
  }

  // ── Pending sync flag ─────────────────────────────────────
  // true  = há dados locais ainda não enviados ao servidor
  // false = local e remoto estão sincronizados

  function setPendingSync(value) {
    safeSet(KEYS.PENDING_SYNC, value);
  }

  function getPendingSync() {
    return safeGet(KEYS.PENDING_SYNC, false);
  }

  // ── Messages (admin → cliente) ────────────────────────────

  function saveMessage(msg) {
    return safeSet(KEYS.MESSAGES, msg);
  }

  function getMessage() {
    return safeGet(KEYS.MESSAGES, null);
  }

  function clearMessage() {
    localStorage.removeItem(KEYS.MESSAGES);
  }

  // ── Feed (atividades locais p/ admin offline) ─────────────

  function appendFeedEntry(entry) {
    const feed = safeGet(KEYS.FEED, []);
    feed.unshift({ ...entry, ts: new Date().toISOString() });
    if (feed.length > 100) feed.length = 100;
    safeSet(KEYS.FEED, feed);
  }

  function getFeed() {
    return safeGet(KEYS.FEED, []);
  }

  // ── Export ────────────────────────────────────────────────

  function exportAll() {
    const config  = getConfig();
    const history = getHistory();
    const months  = {};
    Object.keys(history).forEach(k => { months[k] = getMonthData(k); });
    return {
      exportedAt: new Date().toISOString(),
      config: { ...config, supabaseKey: '[REDACTED]', adminPassword: '[REDACTED]' },
      history,
      months,
    };
  }

  // ── Utils ─────────────────────────────────────────────────

  function _sum(list = []) {
    return list.reduce((acc, i) => acc + (parseFloat(i.value) || 0), 0);
  }

  // ── Public API ────────────────────────────────────────────

  return {
    currentMonthKey,
    getConfig, saveConfig,
    getMonthData, saveMonthData, clearMonthData,
    getHistory,
    setPendingSync, getPendingSync,
    saveMessage, getMessage, clearMessage,
    appendFeedEntry, getFeed,
    exportAll,
  };

})();
