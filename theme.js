(function () {
  'use strict';
  const KEY = 'hris-ui-theme';
  const root = document.documentElement;

  function readTheme() {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === 'dark' || saved === 'light' ? saved : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function applyTheme(theme) {
    const value = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', value);
    root.style.colorScheme = value;
    const button = document.getElementById('themeToggle');
    if (button) {
      button.textContent = value === 'dark' ? '☀ Light mode' : '☾ Dark mode';
      button.setAttribute('aria-label', value === 'dark' ? 'Aktifkan light mode' : 'Aktifkan dark mode');
      button.setAttribute('aria-pressed', String(value === 'dark'));
    }
    try { localStorage.setItem(KEY, value); } catch (_) {}
  }

  function ensureToggle() {
    const target = document.querySelector('.topbar') || document.querySelector('.login-card');
    if (!target) return;
    let button = document.getElementById('themeToggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'themeToggle';
      button.type = 'button';
      button.addEventListener('click', function () {
        applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    }
    if (button.parentElement !== target) {
      button.classList.toggle('theme-toggle-login', target.classList.contains('login-card'));
      target.appendChild(button);
    }
    applyTheme(root.getAttribute('data-theme') || readTheme());
  }

  applyTheme(readTheme());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureToggle, { once: true });
  } else {
    ensureToggle();
  }
  const observer = new MutationObserver(ensureToggle);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();