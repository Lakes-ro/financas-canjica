
const SupabaseSync = (() => {

  // ── Credenciais ───────────────────────────────────────────
  const SUPABASE_URL  = 'https://ywossdxnqhrhznglsvcr.supabase.co';
  const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3b3NzZHhucWhyaHpuZ2xzdmNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxOTIzMjcsImV4cCI6MjA4OTc2ODMyN30.q654hvqIXjT2qi5fsLKYLx_VwCkFRCHNdYqHBfN08Uo';

  // ID fixo do cliente — pode ser alterado via config
  const DEFAULT_USER_ID = 'gisele';

  let _url    = SUPABASE_URL;
  let _key    = SUPABASE_KEY;
  let _userId = DEFAULT_USER_ID;

  // Modo admin: quando true, o admin pode buscar dados de qualquer userId
  let _isAdminMode = false;

  let _onMonthChange = null;
  let _onActivity    = null;
  let _onMessage     = null;

  // ── Init ──────────────────────────────────────────────────

  function init() {
    _url    = SUPABASE_URL;
    _key    = SUPABASE_KEY;
    // userId pode ser configurado via Storage (suporte a múltiplos clientes)
    const cfg = (typeof Storage !== 'undefined') ? Storage.getConfig() : {};
    _userId = cfg.clientUserId || DEFAULT_USER_ID;
    _isAdminMode = false;
  }

  function setAdminMode(userId) {
    _isAdminMode = true;
    if (userId) _userId = userId;
  }

  function setClientMode() {
    _isAdminMode = false;
    const cfg = (typeof Storage !== 'undefined') ? Storage.getConfig() : {};
    _userId = cfg.clientUserId || DEFAULT_USER_ID;
  }

  function isConfigured() {
    return Boolean(_url && _key);
  }

  function getUserId() { return _userId; }

  // ── Headers ───────────────────────────────────────────────

  function _headers(extra = {}) {
    return {
      'Content-Type':  'application/json',
      'apikey':         _key,
      'Authorization': `Bearer ${_key}`,
      ...extra,
    };
  }

  function getBeaconHeaders() {
    return _headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  }

  function getRestUrl(table) {
    return `${_url}/rest/v1/${table}`;
  }

  // ── REST: finance_months ──────────────────────────────────

  async function pushMonthData(monthKey, data) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await fetch(`${_url}/rest/v1/finance_months`, {
        method:  'POST',
        headers: _headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body:    JSON.stringify({
          month_key:  monthKey,
          user_id:    _userId,
          data,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) return { ok: false, reason: await res.text() };
      return { ok: true };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  async function pullMonthData(monthKey, targetUserId) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    const uid = targetUserId || _userId;
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_months?month_key=eq.${monthKey}&user_id=eq.${encodeURIComponent(uid)}&select=data,updated_at`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, reason: await res.text() };
      const rows = await res.json();
      if (!rows.length) return { ok: true, data: null };
      return { ok: true, data: rows[0].data, updatedAt: rows[0].updated_at };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  // ── Admin: listar todos os meses de um userId ─────────────

  async function adminFetchAllMonths(userId) {
    if (!isConfigured()) return { ok: false, data: [] };
    const uid = userId || _userId;
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_months?user_id=eq.${encodeURIComponent(uid)}&order=month_key.desc&select=month_key,updated_at,data`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, data: [] };
      return { ok: true, data: await res.json() };
    } catch { return { ok: false, data: [] }; }
  }

  // ── REST: finance_activity ────────────────────────────────

  async function logActivity(action, detail = '', icon = '•') {
    if (typeof Storage !== 'undefined') {
      Storage.appendFeedEntry({ action, detail, icon });
    }
    if (!isConfigured() || !navigator.onLine) return;
    try {
      await fetch(`${_url}/rest/v1/finance_activity`, {
        method:  'POST',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body:    JSON.stringify({
          user_id:   _userId,
          month_key: (typeof Storage !== 'undefined') ? Storage.currentMonthKey() : '',
          action,
          detail,
          icon,
        }),
      });
    } catch { /* silencioso */ }
  }

  async function fetchActivity(monthKey, limit = 50, targetUserId) {
    if (!isConfigured()) return { ok: false, data: [] };
    const uid = targetUserId || _userId;
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_activity?user_id=eq.${encodeURIComponent(uid)}&month_key=eq.${monthKey}&order=created_at.desc&limit=${limit}`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, data: [] };
      return { ok: true, data: await res.json() };
    } catch { return { ok: false, data: [] }; }
  }

  // ── REST: finance_messages ────────────────────────────────

  async function pushMessage(text, type = 'info', targetUserId) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    const uid = targetUserId || _userId;
    try {
      const res = await fetch(`${_url}/rest/v1/finance_messages`, {
        method:  'POST',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body:    JSON.stringify({ user_id: uid, text, type, read: false }),
      });
      if (!res.ok) return { ok: false, reason: await res.text() };
      return { ok: true };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  async function fetchUnreadMessages(targetUserId) {
    if (!isConfigured()) return { ok: false, data: [] };
    const uid = targetUserId || _userId;
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_messages?user_id=eq.${encodeURIComponent(uid)}&read=eq.false&order=created_at.desc&limit=5`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, data: [] };
      return { ok: true, data: await res.json() };
    } catch { return { ok: false, data: [] }; }
  }

  async function markMessageRead(id) {
    if (!isConfigured()) return;
    try {
      await fetch(`${_url}/rest/v1/finance_messages?id=eq.${id}`, {
        method:  'PATCH',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body:    JSON.stringify({ read: true }),
      });
    } catch { /* silencioso */ }
  }

  // ── Admin: editar dados do cliente direto no Supabase ─────

  async function adminPushMonthData(monthKey, data, targetUserId) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    const uid = targetUserId || _userId;
    try {
      const res = await fetch(`${_url}/rest/v1/finance_months`, {
        method:  'POST',
        headers: _headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body:    JSON.stringify({
          month_key:  monthKey,
          user_id:    uid,
          data,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) return { ok: false, reason: await res.text() };
      return { ok: true };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  let _ws             = null;
  let _wsHeartbeat    = null;
  let _reconnectTimer = null;

  function connectRealtime(onStatusChange, targetUserId) {
    if (!isConfigured()) {
      onStatusChange?.('not_configured');
      return;
    }

    const uid    = targetUserId || _userId;
    const wsUrl  = _url.replace('https://', 'wss://').replace('http://', 'ws://');

    function connect() {
      try {
        _ws = new WebSocket(`${wsUrl}/realtime/v1/websocket?apikey=${_key}&vsn=1.0.0`);

        _ws.onopen = () => {
          onStatusChange?.('live');
          ['finance_months', 'finance_activity', 'finance_messages'].forEach(table => {
            _ws.send(JSON.stringify({
              topic:   `realtime:public:${table}`,
              event:   'phx_join',
              payload: { config: { broadcast: { self: false }, presence: { key: '' } } },
              ref:     null,
            }));
          });
          _wsHeartbeat = setInterval(() => {
            if (_ws.readyState === WebSocket.OPEN) {
              _ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: null }));
            }
          }, 30000);
        };

        _ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.event === 'phx_reply' || msg.topic === 'phoenix') return;
            const { topic, payload } = msg;
            const record = payload?.record || payload?.new;
            if (!record) return;
            // Filtra por userId do cliente monitorado
            if (record.user_id && record.user_id !== uid) return;
            if (topic?.includes('finance_months'))        _onMonthChange?.(record);
            else if (topic?.includes('finance_activity')) _onActivity?.(record);
            else if (topic?.includes('finance_messages')) _onMessage?.(record);
          } catch { /* ignora mensagens inválidas */ }
        };

        _ws.onerror = () => onStatusChange?.('error');

        _ws.onclose = () => {
          onStatusChange?.('connecting');
          clearInterval(_wsHeartbeat);
          clearTimeout(_reconnectTimer);
          _reconnectTimer = setTimeout(connect, 5000);
        };

      } catch { onStatusChange?.('error'); }
    }

    connect();
  }

  function disconnectRealtime() {
    clearTimeout(_reconnectTimer);
    clearInterval(_wsHeartbeat);
    _ws?.close();
    _ws = null;
  }

  function setCallbacks({ onMonthChange, onActivity, onMessage }) {
    _onMonthChange = onMonthChange || null;
    _onActivity    = onActivity    || null;
    _onMessage     = onMessage     || null;
  }

  async function testConnection(url, key) {
    try {
      const res = await fetch(`${url.trim()}/rest/v1/`, {
        headers: { 'apikey': key.trim(), 'Authorization': `Bearer ${key.trim()}` },
      });
      return res.status < 500;
    } catch { return false; }
  }

  return {
    init,
    setAdminMode, setClientMode,
    isConfigured,
    getUserId,
    getRestUrl, getBeaconHeaders,
    pushMonthData, pullMonthData,
    adminFetchAllMonths, adminPushMonthData,
    logActivity, fetchActivity,
    pushMessage, fetchUnreadMessages, markMessageRead,
    connectRealtime, disconnectRealtime,
    setCallbacks,
    testConnection,
  };

})();
