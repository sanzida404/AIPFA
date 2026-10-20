(() => {
  'use strict';
  const button = document.getElementById('install-app');
  if (!button) return;

  let installPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const showButton = () => { button.hidden = isStandalone(); };
  showButton();
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', showButton);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    showButton();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; showButton(); });

  button.addEventListener('click', async () => {
    if (isStandalone()) return;
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      return;
    }
    const guidance = isAppleMobile
      ? 'To install AIPFA on iPhone or iPad:\n1. Open this site in Safari over HTTPS.\n2. Tap Share.\n3. Choose “Add to Home Screen”.\n4. Tap Add.'
      : 'Open the browser menu and choose “Install app” or “Add to Home screen”. If that option is missing, open the deployed site over HTTPS and reload it.';
    window.alert(guidance);
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
