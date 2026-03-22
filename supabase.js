/**
 * supabase.js
 * Sincronização com Supabase + Realtime (WebSocket) para o painel admin.
 *
 * ── SQL para criar as tabelas no Supabase ──────────────────
 *
 * -- 1. Dados financeiros mensais
 * create table if not exists finance_months (
 *   id          uuid primary key default gen_random_uuid(),
 *   month_key   text not null,
 *   user_id     text not null,
 *   data        jsonb not null,
 *   updated_at  timestamptz default now(),
 *   unique (month_key, user_id)
 * );
 *
 * -- 2. Feed de atividades (log de ações)
 * create table if not exists finance_activity (
 *   id         uuid primary key default gen_random_uuid(),
 *   user_id    text not null,
 *   month_key  text not null,
 *   action     text not null,
 *   detail     text,
 *   icon       text,
 *   created_at timestamptz default now()
 * );
 *
 * -- 3. Mensagens admin → cliente
 * create table if not exists finance_messages (
 *   id         uuid primary key default gen_random_uuid(),
 *   user_id    text not null,
 *   text       text not null,
 *   type       text default 'info',
 *   read       boolean default false,
 *   created_at timestamptz default now()
 * );
 *
 * -- Habilitar Realtime nas 3 tabelas:
 * -- No Supabase: Database → Replication → enable para finance_months, finance_activity, finance_messages
 *
 * -- RLS permissiva para uso pessoal (anon key):
 * alter table finance_months    enable row level security;
 * alter table finance_activity  enable row level security;
 * alter table finance_messages  enable row level security;
 *
 * create policy "public_all" on finance_months    for all using (true) with check (true);
 * create policy "public_all" on finance_activity  for all using (true) with check (true);
 * create policy "public_all" on finance_messages  for all using (true) with check (true);
 */

const SupabaseSync = (() => {

  let _url    = '';
  let _key    = '';
  let _userId = '';

  // Referências de canal WebSocket
  let _channelMonths    = null;
  let _channelActivity  = null;
  let _channelMessages  = null;

  // Callbacks injetados externamente
  let _onMonthChange   = null;
  let _onActivity      = null;
  let _onMessage       = null;

  // ── Credenciais — coloque aqui as suas keys do Supabase ─────
  // Acesse: supabase.com → seu projeto → Settings → API
  const SUPABASE_URL = 'COLE_AQUI_A_URL_DO_PROJETO';   // ex: https://abcxyz.supabase.co
  const SUPABASE_KEY = 'COLE_AQUI_A_ANON_KEY';         // ex: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

  // ── Init ──────────────────────────────────────────────────

  function init() {
    const cfg = Storage.getConfig();
    // URL e Key vêm do código (não do app) — edite as constantes acima
    _url    = SUPABASE_URL !== 'COLE_AQUI_A_URL_DO_PROJETO' ? SUPABASE_URL : '';
    _key    = SUPABASE_KEY !== 'COLE_AQUI_A_ANON_KEY'       ? SUPABASE_KEY : '';
    _userId = cfg.userId?.trim() || cfg.userName?.trim() || 'usuario';
  }

  function isConfigured() {
    return Boolean(_url && _key);
  }

  // ── Headers ───────────────────────────────────────────────

  function _headers(extra = {}) {
    return {
      'Content-Type':  'application/json',
      'apikey':         _key,
      'Authorization': `Bearer ${_key}`,
      ...extra,
    };
  }

  // ── REST: finance_months ──────────────────────────────────

  async function pushMonthData(monthKey, data) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await fetch(`${_url}/rest/v1/finance_months`, {
        method: 'POST',
        headers: _headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({
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

  async function pullMonthData(monthKey) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_months?month_key=eq.${monthKey}&user_id=eq.${encodeURIComponent(_userId)}&select=data,updated_at`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, reason: await res.text() };
      const rows = await res.json();
      if (!rows.length) return { ok: true, data: null };
      return { ok: true, data: rows[0].data, updatedAt: rows[0].updated_at };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  // ── REST: finance_activity ────────────────────────────────

  async function logActivity(action, detail = '', icon = '•') {
    if (!isConfigured()) return;
    const monthKey = Storage.currentMonthKey();

    // Persiste localmente também
    Storage.appendFeedEntry({ action, detail, icon });

    try {
      await fetch(`${_url}/rest/v1/finance_activity`, {
        method: 'POST',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
          user_id:   _userId,
          month_key: monthKey,
          action,
          detail,
          icon,
        }),
      });
    } catch { /* falha silenciosa — já foi salvo localmente */ }
  }

  async function fetchActivity(monthKey, limit = 50) {
    if (!isConfigured()) return { ok: false, data: [] };
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_activity?user_id=eq.${encodeURIComponent(_userId)}&month_key=eq.${monthKey}&order=created_at.desc&limit=${limit}`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, data: [] };
      return { ok: true, data: await res.json() };
    } catch { return { ok: false, data: [] }; }
  }

  // ── REST: finance_messages ────────────────────────────────

  async function pushMessage(text, type = 'info') {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await fetch(`${_url}/rest/v1/finance_messages`, {
        method: 'POST',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({ user_id: _userId, text, type, read: false }),
      });
      if (!res.ok) return { ok: false, reason: await res.text() };
      return { ok: true };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  async function fetchUnreadMessages() {
    if (!isConfigured()) return { ok: false, data: [] };
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_messages?user_id=eq.${encodeURIComponent(_userId)}&read=eq.false&order=created_at.desc&limit=5`,
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
        method: 'PATCH',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({ read: true }),
      });
    } catch { /* silencioso */ }
  }

  // ── Realtime via WebSocket nativo ─────────────────────────
  // Supabase Realtime usa ws:// — fazemos a conexão manualmente
  // sem depender do SDK para manter o projeto sem build tools.

  let _ws = null;
  let _wsHeartbeat = null;
  let _wsReady = false;
  let _realtimeCallbacks = new Set();
  let _reconnectTimer = null;

  function connectRealtime(onStatusChange) {
    if (!isConfigured()) {
      onStatusChange?.('not_configured');
      return;
    }

    const wsUrl = _url
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    function connect() {
      try {
        _ws = new WebSocket(`${wsUrl}/realtime/v1/websocket?apikey=${_key}&vsn=1.0.0`);

        _ws.onopen = () => {
          _wsReady = true;
          onStatusChange?.('live');

          // Subscreve nas 3 tabelas
          const tables = ['finance_months', 'finance_activity', 'finance_messages'];
          tables.forEach(table => {
            _ws.send(JSON.stringify({
              topic:   `realtime:public:${table}`,
              event:   'phx_join',
              payload: { config: { broadcast: { self: false }, presence: { key: '' } } },
              ref:     null,
            }));
          });

          // Heartbeat a cada 30s
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
            if (record.user_id && record.user_id !== _userId) return;

            if (topic?.includes('finance_months')) {
              _onMonthChange?.(record);
            } else if (topic?.includes('finance_activity')) {
              _onActivity?.(record);
            } else if (topic?.includes('finance_messages')) {
              _onMessage?.(record);
            }
          } catch { /* ignora mensagens inválidas */ }
        };

        _ws.onerror = () => {
          onStatusChange?.('error');
        };

        _ws.onclose = () => {
          _wsReady = false;
          onStatusChange?.('connecting');
          clearInterval(_wsHeartbeat);

          // Reconecta em 5s
          clearTimeout(_reconnectTimer);
          _reconnectTimer = setTimeout(connect, 5000);
        };

      } catch {
        onStatusChange?.('error');
      }
    }

    connect();
  }

  function disconnectRealtime() {
    clearTimeout(_reconnectTimer);
    clearInterval(_wsHeartbeat);
    _ws?.close();
    _ws = null;
    _wsReady = false;
  }

  function setCallbacks({ onMonthChange, onActivity, onMessage }) {
    _onMonthChange  = onMonthChange  || null;
    _onActivity     = onActivity     || null;
    _onMessage      = onMessage      || null;
  }

  // ── Test connection ───────────────────────────────────────

  async function testConnection(url, key) {
    try {
      const res = await fetch(`${url.trim()}/rest/v1/`, {
        headers: { 'apikey': key.trim(), 'Authorization': `Bearer ${key.trim()}` },
      });
      return res.status < 500;
    } catch { return false; }
  }

  // ── Sync on online ────────────────────────────────────────

  async function syncIfOnline(monthKey) {
    if (!navigator.onLine || !isConfigured()) return;

    const local  = Storage.getMonthData(monthKey);
    const remote = await pullMonthData(monthKey);
    if (!remote.ok) return;

    if (remote.data && remote.updatedAt > (local.updatedAt || '')) {
      Storage.saveMonthData(remote.data, monthKey);
      return { merged: true, data: remote.data };
    }

    await pushMonthData(monthKey, local);
    return { merged: false };
  }

  // ── Public API ────────────────────────────────────────────

  return {
    init,
    isConfigured,
    pushMonthData,
    pullMonthData,
    logActivity,
    fetchActivity,
    pushMessage,
    fetchUnreadMessages,
    markMessageRead,
    connectRealtime,
    disconnectRealtime,
    setCallbacks,
    testConnection,
    syncIfOnline,
  };

})();
