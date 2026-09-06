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

// ── DARK MODE PERSISTENCE ──────────────────
// Restore saved theme before paint to avoid flash
(function() {
    if (localStorage.getItem('prova_theme') === 'dark') {
        // Set data-theme on <html> immediately (before paint)
        document.documentElement.setAttribute('data-theme', 'dark');
        document.addEventListener('DOMContentLoaded', function() {
            document.body.classList.add('dark-theme');
            const icon = document.querySelector('#themeToggle i');
            if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); }
        });
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
    }
})();

// Patch all themeToggle buttons to save preference
document.addEventListener('DOMContentLoaded', function() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;
    // Sync icon on page load
    if (localStorage.getItem('prova_theme') === 'dark') {
        const icon = themeToggle.querySelector('i');
        if (icon) { icon.classList.remove('fa-moon'); icon.classList.add('fa-sun'); }
    }
});
