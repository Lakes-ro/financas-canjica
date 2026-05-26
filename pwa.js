/**
 * pwa.js
 * Gerencia instalação PWA e registro do Service Worker.
 * Compatível com Android (Chrome/Samsung) e iOS (Safari).
 *
 * IMPORTANTE: beforeinstallprompt deve ser capturado no topo,
 * fora de qualquer evento, pois pode disparar antes do DOMContentLoaded.
 */

(function PWA() {

  let _deferredPrompt = null;
  let _domReady = false;

  // ── CAPTURA ANTECIPADA do prompt de instalação ────────────
  // Deve ficar no topo, FORA do DOMContentLoaded
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    console.log('[PWA] beforeinstallprompt capturado');

    // Se o DOM já estiver pronto, mostra o banner imediatamente
    // Se não, o DOMContentLoaded vai mostrar quando carregar
    if (_domReady) {
      _showInstallBanner();
    }
  });

  window.addEventListener('appinstalled', () => {
    _deferredPrompt = null;
    _hideInstallBanner();
    console.log('[PWA] App instalado com sucesso!');
  });

  // ── DOM pronto ────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    _domReady = true;

    // Se o beforeinstallprompt já chegou antes do DOM, mostra agora
    if (_deferredPrompt) {
      _showInstallBanner();
    }

    // ── Botão instalar ────────────────────────────────────
    document.getElementById('btn-install')?.addEventListener('click', async () => {
      if (!_deferredPrompt) return;
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      console.log('[PWA] Escolha do usuário:', outcome);
      if (outcome === 'accepted') {
        _hideInstallBanner();
        if (typeof UI !== 'undefined') UI.toast('App instalado!', 'success');
      }
      _deferredPrompt = null;
    });

    document.getElementById('btn-install-dismiss')?.addEventListener('click', _hideInstallBanner);

    // ── iOS Safari ────────────────────────────────────────
    // Safari não dispara beforeinstallprompt — detecta manualmente
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
               || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                      || window.navigator.standalone === true;

    if (isIos && !isStandalone) {
      // Mostra instrução de instalação manual para iOS
      const banner = document.getElementById('install-banner');
      if (banner) {
        const span = banner.querySelector('span');
        if (span) span.textContent = '📲 Safari: toque em ⎙ → "Adicionar à Tela de Início"';
        document.getElementById('btn-install')?.setAttribute('hidden', '');
        banner.removeAttribute('hidden');
      }
    }

    // ── Já está instalado como PWA ────────────────────────
    if (isStandalone) {
      _hideInstallBanner();
    }
  });

  // ── Registro do Service Worker ────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .then((reg) => {
          console.log('[PWA] Service Worker registrado. Scope:', reg.scope);

          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            sw?.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] Nova versão disponível');
              }
            });
          });
        })
        .catch((err) => {
          console.warn('[PWA] Falha ao registrar Service Worker:', err);
        });
    });
  }

  // ── Helpers ───────────────────────────────────────────────

  function _showInstallBanner() {
    document.getElementById('install-banner')?.removeAttribute('hidden');
  }

  function _hideInstallBanner() {
    document.getElementById('install-banner')?.setAttribute('hidden', '');
  }

})();
