const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const out=[];
for (let k=0;k<3;k++){ const p = await b.newPage(); const t0=Date.now();
  await p.goto('http://127.0.0.1:8000/?lang=en&nogist', { timeout: 60000 }); const tl=Date.now()-t0;
  const t1=Date.now(); await p.waitForFunction(() => typeof clearBootLoading === 'function', null, { timeout: 60000 }); 
  out.push(`load=${tl}ms ready=+${Date.now()-t1}ms`); await p.close(); }
console.log(out.join(' | ')); await b.close(); })();
