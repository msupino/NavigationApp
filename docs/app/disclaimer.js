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
// Once, not every launch: acknowledging it stores the version acknowledged. Bumping
// DISCLAIMER_VERSION is how a materially changed notice is put in front of everyone again,
// and it is the only thing that should ever do so.
(function () {
  const KEY = 'navaid.disclaimerAck';
  // The date the wording last changed materially. Not the app version: this asks again only
  // when what is being acknowledged is different.
  const DISCLAIMER_VERSION = '2026-09-13';

  const featureOn = () => typeof tune !== 'function' || tune('featureDisclaimer') !== false;

  function accepted() {
    try { return localStorage.getItem(KEY) === DISCLAIMER_VERSION; } catch (e) { return false; }
  }
  function remember() {
    try { localStorage.setItem(KEY, DISCLAIMER_VERSION); } catch (e) { /* private mode */ }
  }

  function textOf(key, fallback) {
    const S2 = window.S || {};
    return S2[key] || fallback;
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

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = textOf('disclaimerTitle', 'Before you fly');
    box.appendChild(title);

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
      remember();
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
    if (!featureOn() || accepted()) return null;
    return showDisclaimer();
  }

  window.NavAid = window.NavAid || {};
  NavAid.showDisclaimer = showDisclaimer;
  NavAid.disclaimerAccepted = accepted;
  NavAid.disclaimerVersion = DISCLAIMER_VERSION;
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
