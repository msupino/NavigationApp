const { test, expect } = require('./_setup');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'scripts',
  'chart-monitor-recovery.mjs')).href;

test('stale feeds dispatch each producer once and recover before alerting', async () => {
  const { recoverStaleFeeds } = await import(moduleUrl);
  const initial = {
    stale: [
      { workflow: 'aviation-data.yml' },
      { workflow: 'aviation-data.yml' },
      { workflow: 'ims-charts.yml' },
    ],
    unknown: [],
  };
  const dispatched = [];
  const sleeps = [];
  const snapshots = [
    { stale: [{ workflow: 'ims-charts.yml' }], unknown: [] },
    { stale: [], unknown: [] },
  ];
  const result = await recoverStaleFeeds({
    initial,
    dispatch: async workflow => { dispatched.push(workflow); },
    check: async () => snapshots.shift(),
    sleep: async ms => { sleeps.push(ms); },
    maxWaitMs: 20,
    pollMs: 10,
  });

  expect(dispatched.sort()).toEqual(['aviation-data.yml', 'ims-charts.yml']);
  expect(sleeps).toEqual([10, 10]);
  expect(result.recovered).toBe(true);
  expect(result.waitedMs).toBe(20);
});

test('dispatch failures and transient checks never masquerade as recovery', async () => {
  const { recoverStaleFeeds } = await import(moduleUrl);
  let checks = 0;
  const initial = {
    stale: [{ workflow: 'aviation-data.yml' }, { workflow: 'notam.yml' }],
    unknown: [],
  };
  const result = await recoverStaleFeeds({
    initial,
    dispatch: async workflow => {
      if (workflow === 'notam.yml') throw new Error('dispatch denied');
    },
    check: async () => {
      checks += 1;
      return { stale: [], unknown: ['temporary raw feed failure'] };
    },
    sleep: async () => {},
    maxWaitMs: 20,
    pollMs: 10,
  });

  expect(checks).toBe(2);
  expect(result.recovered).toBe(false);
  expect(result.dispatchErrors).toEqual([{ workflow: 'notam.yml', error: 'dispatch denied' }]);
});
