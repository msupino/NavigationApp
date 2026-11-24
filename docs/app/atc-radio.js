// ATC-IL's radio page embedded for native NavAid users. Playback and station selection stay
// inside the provider's own page so its session and signed stream URLs are created there.
(function () {
  'use strict';
  const PROVIDER_URL = 'https://www.atc-il.live/';
  const str = (k, fb) => (typeof S !== 'undefined' && S[k]) || fb;
  const isNativeApp = () => {
    const cap = window.Capacitor;
    return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  };
  // Permit the PR deployment preview on phones so the iframe can be tried before merging.
  // The production website in a regular browser still has no ATC controls.
  const isPrPreview = location.hostname === 'navaid.supino.org'
    && /^\/pr\/\d+(?:\/|$)/.test(location.pathname);
  const offered = () => (isNativeApp() || isPrPreview)
    && (typeof tune !== 'function' || tune('featureAtcIlEmbed') !== false);
  const modal = document.getElementById('atc-modal');
  const frame = document.getElementById('atc-il-frame');
  const opener = document.getElementById('tool-atc-radio');
  const closeButton = document.getElementById('atc-modal-close');
  if (!modal || !frame || !opener || !closeButton) return;

  let loaded = false;

  function updateOpener(open) {
    opener.setAttribute('aria-pressed', open ? 'true' : 'false');
    opener.setAttribute('aria-expanded', open ? 'true' : 'false');
    opener.classList.toggle('active', open);
    opener.title = str('atcRadioTitle', 'ATC radio');
    opener.setAttribute('aria-label', opener.title);
  }

  function open() {
    if (!offered()) return;
    if (!loaded) {
      frame.src = PROVIDER_URL;
      loaded = true;
    }
    modal.classList.remove('hidden');
    updateOpener(true);
  }

  function close() {
    modal.classList.add('hidden');
    updateOpener(false);
    opener.focus();
  }

  // Removing the embedded document stops any audio it is playing. Closing the panel leaves the
  // provider page alive, matching the prior behavior where hiding the panel did not stop audio.
  function stop() {
    if (loaded) {
      frame.src = 'about:blank';
      loaded = false;
    }
    if (!modal.classList.contains('hidden')) close();
    else updateOpener(false);
  }

  function refreshAtcRadioFeature() {
    const on = offered();
    opener.hidden = !on;
    if (!on) stop();
  }

  closeButton.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.preventDefault(); close(); }
  });

  window.refreshAtcRadioFeature = refreshAtcRadioFeature;
  window.atcRadio = { open, close, stop };
  refreshAtcRadioFeature();
})();
