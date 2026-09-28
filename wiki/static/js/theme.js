/* Dark/light theme toggle shared by the wiki and mods sites.
   The initial data-theme is set by the inline head script in the base layouts
   so there is no flash before this file loads; this only wires up the button,
   keeps the icon in sync and persists the choice to localStorage. */

(function () {
  const STORAGE_KEY = 'breakmine-theme';

  function read() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function write(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* private mode or storage disabled: the toggle still works for this page */
    }
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    const button = document.getElementById('theme-toggle');
    if (button) {
      const dark = theme === 'dark';
      button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      button.setAttribute('title', dark ? 'Switch to light theme' : 'Switch to dark theme');

      const icon = document.getElementById('theme-toggle-icon');
      if (icon) {
        icon.textContent = dark ? 'light_mode' : 'dark_mode';
      }
    }
  }

  window.setTheme = function (theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    write(next);
    apply(next);
  };

  window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme');
    window.setTheme(current === 'dark' ? 'light' : 'dark');
  };

  document.addEventListener('DOMContentLoaded', function () {
    const stored = read();
    apply(stored === 'dark' || stored === 'light' ? stored : document.documentElement.getAttribute('data-theme') || 'light');

    const button = document.getElementById('theme-toggle');
    if (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        window.toggleTheme();
      });
    }
  });
})();
