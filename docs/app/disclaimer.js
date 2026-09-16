'use strict';

// The safety acknowledgement, shown once before the chart is used.
//
// Everything it says is already in terms.html, and that page is linked from the footer --
// but a link in a footer is not an acknowledgement. An aeroplane app that draws routes on
// aeronautical charts has to say, in front of the pilot and before they start, that it is
// not certified for navigation and that the official publications are what they fly by.
// Apple's reviewers look for exactly this on an aviation app, and it is the right thing on
// the web too, so it lives in the app rather than in the native shell.
//
// EVERY launch, not once: the same way airmap-israel opens. A pilot starting the app is
// about to fly, and "you agreed to this in March" is not what a notice about not navigating
// by it is for -- it is read at the top of the session, like a briefing, or it is decoration.
// So nothing is remembered: no stored acknowledgement, no wording version, no per-language
// bookkeeping. Opening the app is the trigger, and pressing the button is the whole answer.
//
// It follows that a RELOAD shows it again, because a reload is a launch: a web refresh, a
// language switch (lang-select navigates), an APK picking up a new build, an embedded iOS
// bundle installed at startup. That is the intended reading of "every launch" and not an
// accident of one.
(function () {
  const featureOn = () => typeof tune !== 'function' || tune('featureDisclaimer') !== false;
  // The suite would otherwise meet this modal in every one of its thousands of specs, and a
  // notice shown on every launch cannot be acknowledged away for them. tests/_setup.js sets
  // this; nothing in the app ever does.
  const suppressed = () => window.__navaidNoDisclaimer === true;

  function textOf(key, fallback) {
    const S2 = window.S || {};
    return S2[key] || fallback;
  }

  // The same control the menu has, on the notice: a dropdown, listing HE and EN. Two letters
  // rather than עברית and English, because the whole point of this control is to be usable
  // by someone who cannot read the page it is sitting on -- and a code that is the same in
  // both alphabets is legible from either side. The language's own name rides on the option
  // as its title, for whoever wants it spelt out.
  // Switching is a navigation, as it is in the menu, and the notice opens again on the other
  // side, which is the point.
  const LANGUAGES = [['he', 'HE', 'עברית'], ['en', 'EN', 'English']];

  function languageSwitch() {
    const wrap = document.createElement('div');
    wrap.className = 'disclaimer-langs';
    const current = lang();
    const select = document.createElement('select');
    select.className = 'disclaimer-lang-select';
    select.setAttribute('aria-label', 'Language / שפה');
    for (const [code, label, name] of LANGUAGES) {
      const option = document.createElement('option');
      option.value = code;
      option.lang = 'en';                 // HE and EN are Latin, whichever language they name
      option.textContent = label;
      option.title = name;
      option.setAttribute('aria-label', name);
      if (code === current) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      const code = select.value;
      if (code === current) return;
      // This is the app's language, not the notice's: ?lang carries the choice, index.html
      // persists it on the way back up, and the map, the menu and every panel come back in
      // it. Writing the key here as well would put a second author on a setting whose home
      // is index.html -- and the allowlist test is right to ask who owns it.
      try {
        // Everything else about the address is kept: a follower reading this arrived on
        // ?follow=<id>#k=<key>, and a language switch that dropped either would take the
        // aeroplane away from them to answer a question about words.
        const url = new URL(location.href);
        url.searchParams.set('lang', code);
        location.href = url.toString();
      } catch (e) { location.search = '?lang=' + code; }
    });
    wrap.appendChild(select);
    return wrap;
  }

  // Which language the notice is being read in, resolved the way index.html resolved it
  // before any of this loaded: it stamps the answer on <html>.
  function lang() {
    return (document.documentElement.lang || '').toLowerCase().startsWith('he') ? 'he' : 'en';
  }

  // Built by hand rather than through createDraggableModal: this one is not draggable, has
  // no close X, and does not answer to Escape or a click on the backdrop. A notice with a
  // way out that is not "I understand" is a notice that can be dismissed without being read.
  function build(onAccept) {
    // NOT a .modal-back: the app's global Escape handler removes those, and this one is
    // answered by pressing it, not by escaping it. Same reasoning as the simulator overlay.
    const back = document.createElement('div');
    back.className = 'disclaimer-back';
    const box = document.createElement('div');
    box.className = 'modal disclaimer-modal';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');

    // The notice and the language switch together. A pilot who reads the other language
    // better should not have to dismiss a safety notice in order to find the control that
    // changes it -- especially as this is the first thing the app puts on screen, so the
    // menu's own switch is behind it.
    const head = document.createElement('div');
    head.className = 'disclaimer-head';
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = textOf('disclaimerTitle', 'Before you fly');
    head.appendChild(title);
    head.appendChild(languageSwitch());
    box.appendChild(head);

    const lead = document.createElement('p');
    lead.className = 'disclaimer-lead';
    lead.textContent = textOf('disclaimerLead',
      'NavAid is a planning aid. It is NOT certified for navigation and must not be used as '
      + 'a primary reference in flight.');
    box.appendChild(lead);

    const body = document.createElement('ul');
    body.className = 'disclaimer-points';
    const points = [
      textOf('disclaimerPointOfficial',
        'Plan and fly using current official charts, AIP, NOTAM and weather.'),
      textOf('disclaimerPointData',
        'Chart, airspace, NOTAM and weather data here may be incomplete, delayed or wrong.'),
      textOf('disclaimerPointPic',
        'The pilot in command is responsible for the safe conduct of every flight.'),
    ];
    for (const line of points) {
      const li = document.createElement('li');
      li.textContent = line;
      body.appendChild(li);
    }
    box.appendChild(body);

    // Said where it is true, and only there. The inline tag in index.html defines window.gtag
    // synchronously when its gates pass, so this reads the same decision rather than repeating
    // it: no line in the native app, on staging, on a PR preview or when running locally -- and
    // if the tag is ever removed again, the sentence goes with it instead of standing as a
    // claim about something that no longer happens.
    if (typeof window.gtag === 'function') {
      const note = document.createElement('p');
      note.className = 'disclaimer-note';
      note.textContent = textOf('disclaimerAnalytics',
        'This site uses Google Analytics to count anonymous visits, and it sets Google\u2019s '
        + 'cookies. Your routes, positions and flight plans are never sent to it.');
      box.appendChild(note);
    }

    // The full text, for whoever wants it now rather than from the footer later. New tab:
    // this dialog is not finished with, and losing an unanswered acknowledgement to a
    // navigation would be worse than a second tab.
    const links = document.createElement('p');
    links.className = 'disclaimer-links';
    for (const [href, key, fallback] of [['terms.html', 'tbTerms', 'Terms'],
                                         ['privacy.html', 'tbPrivacy', 'Privacy']]) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = textOf(key, fallback);
      if (links.childNodes.length) links.appendChild(document.createTextNode(' · '));
      links.appendChild(a);
    }
    box.appendChild(links);

    const btns = document.createElement('div');
    btns.className = 'modal-btns disclaimer-btns';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'disclaimer-accept';
    ok.textContent = textOf('disclaimerAccept', 'I understand');
    ok.addEventListener('click', () => {
      back.remove();
      document.body.classList.remove('disclaimer-open');
      if (typeof onAccept === 'function') onAccept();
    });
    btns.appendChild(ok);
    box.appendChild(btns);

    back.appendChild(box);
    document.body.appendChild(back);
    document.body.classList.add('disclaimer-open');
    try { ok.focus(); } catch (e) { /* not focusable yet */ }
    return back;
  }

  // Always available, acknowledged or not: "show me that again" is a reasonable thing to
  // want, and the gist cannot take away a notice a pilot asked for.
  function showDisclaimer(onAccept) {
    const open = document.querySelector('.disclaimer-back');
    if (open) return open;
    return build(onAccept);
  }

  function maybeShowDisclaimer() {
    if (!featureOn() || suppressed()) return null;
    return showDisclaimer();
  }

  window.NavAid = window.NavAid || {};
  NavAid.showDisclaimer = showDisclaimer;
  NavAid.maybeShowDisclaimer = maybeShowDisclaimer;

  // AFTER the boot screen, and `load` is not that moment. #boot-loading is fixed, opaque and
  // z-index 6000 -- above this notice -- and comes down only when the first chart tiles paint
  // (ui.js: armBootLoading, with a bootLogoMinMs floor and a six-second fallback), which is
  // well after the load event. Shown on `load`, the notice was created behind it: invisible,
  // and clickable straight THROUGH it, because the splash drops pointer events as soon as the
  // map is ready. A safety acknowledgement that can be recorded by a tap on a screen which
  // never showed the words is the one thing this must not be.
  //
  // Waiting on the ELEMENT rather than on any event of its own: it is removed by
  // clearBootLoading(), which nothing else announces, and a poll that cannot outlive its
  // reason is cheaper than a contract between two files. The cap is belt and braces -- a
  // boot screen that somehow never goes must not take the notice with it.
  const BOOT_POLL_MS = 100;
  const BOOT_WAIT_CAP_MS = 20000;
  function whenBootScreenGone(run, capMs) {
    const gone = () => !document.getElementById('boot-loading');
    if (gone()) { run(); return; }
    const until = Date.now() + (capMs === undefined ? BOOT_WAIT_CAP_MS : capMs);
    const timer = setInterval(() => {
      if (!gone() && Date.now() < until) return;
      clearInterval(timer);
      run();
    }, BOOT_POLL_MS);
  }
  NavAid.whenBootScreenGone = whenBootScreenGone;

  if (typeof document !== 'undefined') {
    const start = () => whenBootScreenGone(maybeShowDisclaimer);
    if (document.readyState === 'complete') setTimeout(start, 0);
    else window.addEventListener('load', () => setTimeout(start, 0));
  }
}());
