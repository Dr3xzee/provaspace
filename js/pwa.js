// ============================================
// PROVASPACE — PWA bootstrap (service worker registration + install prompt)
// Imported as a plain script (not a module) so it runs on every page reliably.
// ============================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Capture the install prompt so pages can show a custom "Install App" button
window.provaInstallPromptEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.provaInstallPromptEvent = e;
  document.dispatchEvent(new CustomEvent('prova:install-available'));
});

window.provaTriggerInstall = async function () {
  const evt = window.provaInstallPromptEvent;
  if (!evt) return false;
  evt.prompt();
  const choice = await evt.userChoice;
  window.provaInstallPromptEvent = null;
  return choice.outcome === 'accepted';
};
