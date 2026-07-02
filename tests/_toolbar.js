// Helpers for specs that interact with toolbar controls directly. Desktop now
// renders toolbar sections as transient dropdown menus, so a test should open
// the containing section before clicking a command.

async function showToolbarControl(page, selector) {
  await page.evaluate(sel => {
    const target = document.querySelector(sel);
    const targetSection = target?.closest('.tb-section') || null;
    for (const section of document.querySelectorAll('.tb-section')) {
      const open = section === targetSection;
      section.classList.toggle('open', open);
      section.querySelector('.tb-section-head')
        ?.setAttribute('aria-expanded', open ? 'true' : 'false');
      try {
        localStorage.setItem('navaid.sec.' + section.getAttribute('data-sec'), open ? '1' : '0');
      } catch (e) {}
    }
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.classList.remove('multi-open');
      toolbar.dataset.openCount = targetSection ? '1' : '0';
    }
  }, selector);
  await page.locator(selector).scrollIntoViewIfNeeded();
}

async function clickToolbarControl(page, selector) {
  await showToolbarControl(page, selector);
  await page.locator(selector).click();
}

async function hideToolbarMenus(page) {
  await page.evaluate(() => {
    for (const section of document.querySelectorAll('.tb-section.open')) {
      section.classList.remove('open');
      section.querySelector('.tb-section-head')?.setAttribute('aria-expanded', 'false');
      try { localStorage.setItem('navaid.sec.' + section.getAttribute('data-sec'), '0'); }
      catch (e) {}
    }
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.classList.remove('multi-open');
      toolbar.dataset.openCount = '0';
    }
  });
}

// Drive a tool via its keyboard shortcut instead of its toolbar button.
// Use this when a test presets toolbar sections open: in desktop-menubar
// mode the open dropdowns overlay the map, so menu/modal churn can hide the
// button mid-click (the "mosaic-modal incident" flake family). Closes the
// menus (via the app's own closeToolbarMenus when present) and blurs any
// focused element first so the plain-key shortcut isn't swallowed.
async function pressShortcut(page, key) {
  await page.evaluate(() => {
    if (window.closeToolbarMenus) window.closeToolbarMenus();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  await page.keyboard.press(key);
}

module.exports = { clickToolbarControl, hideToolbarMenus, pressShortcut, showToolbarControl };
