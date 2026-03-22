/**
 * sw.js — Service Worker v5
 * Cache-first para assets estáticos.
 * Network-first para Supabase/CDN externo.
 *
 * IMPORTANTE: Incremente CACHE_VERSION a cada deploy para
 * forçar atualização do cache nos dispositivos.
 */

const CACHE_VERSION = 'v7';
const CACHE_NAME    = `caixinhas-${CACHE_VERSION}`;

// Apenas arquivos que existem no projeto
const CACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './admin.css',
  './storage.js',
  './supabase.js',
  './state.js',
  './ui.js',
  './report.js',
  './lancamentos.js',
  './admin.js',
  './app.js',
  './pwa.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// ── Install: pré-cache dos assets essenciais ──────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Adiciona um por um para não falhar tudo se um arquivo não existir
      return Promise.allSettled(
        CACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Falha ao cachear: ${url}`, err);
          })
        )
      );
    }).then(() => {
      console.log(`[SW] Cache ${CACHE_NAME} instalado`);
      return self.skipWaiting(); // Ativa imediatamente sem esperar aba fechar
    })
  );
});

// ── Activate: remove caches antigas ──────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('caixinhas-') && key !== CACHE_NAME)
          .map((key) => {
            console.log(`[SW] Removendo cache antigo: ${key}`);
            return caches.delete(key);
          })
      ))
      .then(() => {
        console.log(`[SW] ${CACHE_NAME} ativo`);
        return self.clients.claim(); // Controla todas as abas abertas imediatamente
      })
  );
});

// ── Fetch: estratégia por tipo de recurso ─────────────────

self.addEventListener('fetch', (event) => {
  // Ignora requisições não-GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Supabase API e WebSocket: sempre network, nunca cache
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // CDN externo (Google Fonts, Chart.js): cache-first com fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }))
      )
    );
    return;
  }

  // App shell (arquivos locais): cache-first, atualiza em background
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      }).catch(() => null);

      // Retorna cache imediatamente se disponível, busca rede em background
      return cached || networkFetch || new Response('Offline', { status: 503 });
    })
  );
});

// ── Push Notifications ────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (e) {}

  const title = data.title || 'Caixinhas';
  const options = {
    body:             data.body  || 'Nova atividade no app',
    icon:             data.icon  || 'icon-192.png',
    badge:            data.badge || 'icon-192.png',
    tag:              data.tag   || 'caixinhas-push',
    renotify:         true,
    requireInteraction: false,
    data:             { url: self.registration.scope },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url && c.focus);
      if (existing) return existing.focus();
      return clients.openWindow(event.notification.data?.url || './');
    })
  );
});
