// Adds explicit direction columns to the altitude-pairs chart without
// changing the core table data model.
(function () {
  function isHebrew() {
    return (document.documentElement.lang || window.__navLang) === 'he';
  }

  function directionLabel() {
    return isHebrew() ? 'כיוון' : 'Direction';
  }

  function altitudeLabel() {
    return isHebrew() ? 'גובה' : 'Altitude';
  }

  function typeLabel() {
    return isHebrew() ? 'סוג' : 'Type';
  }

  function directionCell(text) {
    const td = document.createElement('td');
    const dir = document.createElement('div');
    dir.className = 'charts-alt-direction';
    dir.textContent = text;
    td.appendChild(dir);
    return td;
  }

  function directionHeader() {
    const th = document.createElement('th');
    th.textContent = directionLabel();
    return th;
  }

  function splitPairText(row) {
    const pair = row.querySelector('.charts-alt-pair-button');
    if (!pair) return null;
    const parts = pair.textContent.split('↔').map(s => s.trim()).filter(Boolean);
    return parts.length === 2 ? parts : null;
  }

  function enhanceAltitudePairTable(table) {
    if (!table || table.classList.contains('charts-alt-direction-enhanced')) return;
    const thead = table.tHead;
    const headRow = thead && thead.rows && thead.rows[0];
    if (!headRow || headRow.cells.length < 6) return;
    const legacy = headRow.cloneNode(true);
    legacy.className = 'charts-alt-legacy-head';
    thead.insertBefore(legacy, headRow);
    headRow.classList.add('charts-alt-current-head');
    const inboundAlt = headRow.cells[1];
    const outboundAlt = headRow.cells[2];
    const type = headRow.cells[3];
    inboundAlt.textContent = altitudeLabel();
    outboundAlt.textContent = altitudeLabel();
    type.textContent = typeLabel();
    headRow.insertBefore(directionHeader(), inboundAlt);
    headRow.insertBefore(directionHeader(), outboundAlt);

    for (const row of table.tBodies[0] ? table.tBodies[0].rows : []) {
      const pair = splitPairText(row);
      if (!pair || row.cells.length < 6) continue;
      const inbound = row.cells[1];
      const outbound = row.cells[2];
      row.insertBefore(directionCell(pair[0] + ' → ' + pair[1]), inbound);
      row.insertBefore(directionCell(pair[1] + ' → ' + pair[0]), outbound);
    }
    table.classList.add('charts-alt-direction-enhanced');
  }

  function enhanceOpenAltitudePairTable() {
    installAltitudePairDirectionStyles();
    enhanceAltitudePairTable(document.querySelector('.charts-alt-table'));
  }

  function installAltitudePairDirectionStyles() {
    if (document.getElementById('alt-pair-direction-style')) return;
    const style = document.createElement('style');
    style.id = 'alt-pair-direction-style';
    style.textContent = [
      '.charts-alt-legacy-head{display:none}',
      '.charts-alt-direction{color:#a9a3a3;direction:ltr;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
      'font-size:12px;font-weight:700;line-height:1.2;min-width:112px;',
      'text-align:left;unicode-bidi:isolate;white-space:nowrap}',
      'body.theme-light .charts-alt-direction{color:#6b7280}',
    ].join('');
    document.head.appendChild(style);
  }

  let enhanceQueued = false;
  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    setTimeout(() => {
      enhanceQueued = false;
      enhanceOpenAltitudePairTable();
    }, 0);
  }

  window.enhanceAltitudePairDirectionColumns = enhanceOpenAltitudePairTable;
  document.addEventListener('click', e => {
    const target = e.target && e.target.closest && e.target.closest('#alt-pairs');
    if (target) queueEnhance();
  }, true);
  const observer = new MutationObserver(() => {
    if (document.querySelector('.charts-alt-table')) queueEnhance();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}());
