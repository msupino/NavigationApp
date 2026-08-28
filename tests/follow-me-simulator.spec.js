const { spawnSync } = require('child_process');
const path = require('path');
const { test, expect } = require('./_setup');

const script = path.join(__dirname, '..', 'scripts', 'follow-me-simulator.py');
const template = require('../scripts/routes/LLHZ-to-LLHA.json');
const graph = require('../docs/data/cvfr-route-graph.json');

function python(expression) {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("follow_me_simulator", sys.argv[1])',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(json.dumps(' + expression + '))',
  ].join('\n');
  const result = spawnSync('python3', ['-c', code, script], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Python simulator validation failed');
  return JSON.parse(result.stdout);
}

test('default Follow Me simulator flies the LLHZ-LLHA route waypoints', () => {
  const route = python('module.load_route()');
  expect(route.map(point => point.name)).toEqual([
    'LLHZ', 'BAZRA', 'DEROR', 'SHARO', 'HADRA', 'FRDIS',
    'BOREN', 'HOTRM', 'DAROM', 'GALIM', 'LLHA',
  ]);
  expect(route[0]).toMatchObject({ lat: 32.17944, lng: 34.83444 });
  expect(route.at(-1)).toMatchObject({ lat: 32.80833, lng: 35.04278 });
});

test('bundled LLHZ-LLHA template stays on current route-graph waypoint positions', () => {
  expect(template.legs).toHaveLength(template.waypoints.length - 1);
  for (const waypoint of template.waypoints) {
    expect(graph.nodes[waypoint.name]).toBeDefined();
    expect(waypoint.lat).toBeCloseTo(graph.nodes[waypoint.name].lat, 5);
    expect(waypoint.lng).toBeCloseTo(graph.nodes[waypoint.name].lng, 5);
  }
});

test('simulated fixes follow every leg and use the browser Follow Me schema', () => {
  const result = python(`(lambda route, points: {
    "count": len(points),
    "starts": points[0],
    "ends": points[-1],
    "arrivals": [p["waypoint"] for p in points if p.get("waypoint")],
    "fix": module.make_fix(points[1], "TEST", 100, 1500, 1234, 1200)
  })(module.validate_waypoints([
    {"name":"A","lat":32.0,"lng":34.8},
    {"name":"B","lat":32.01,"lng":34.8},
    {"name":"C","lat":32.01,"lng":34.81}
  ]), module.simulated_points(module.validate_waypoints([
    {"name":"A","lat":32.0,"lng":34.8},
    {"name":"B","lat":32.01,"lng":34.8},
    {"name":"C","lat":32.01,"lng":34.81}
  ]), 100, 2))`);
  expect(result.count).toBeGreaterThan(20);
  expect(result.starts).toMatchObject({ lat: 32, lng: 34.8, waypoint: 'A' });
  expect(result.ends).toMatchObject({ lat: 32.01, lng: 34.81, waypoint: 'C' });
  expect(result.arrivals).toEqual(['A', 'B', 'C']);
  expect(result.fix).toMatchObject({
    reg: 'TEST', alt: 457, kt: 100, t: 1200, seq: 1234,
  });
  expect(result.fix.trk).toBeGreaterThanOrEqual(0);
  expect(result.fix.trk).toBeLessThan(360);
});

test('simulator constructs a fragment-key follower link and supports offline dry-run', () => {
  const link = python('module.follower_link("https://navaid.supino.org/pr/2003/", "topic-id", bytes(range(32)))');
  expect(link).toBe('https://navaid.supino.org/pr/2003/?follow=topic-id#k=' +
    'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');

  const result = spawnSync('python3', [script, '--dry-run'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^Follower link:\nhttps:\/\/navaid\.supino\.org\/\?follow=.+#k=.+/);
  expect(result.stderr).toContain('LLHZ -> BAZRA -> DEROR -> SHARO -> HADRA -> FRDIS -> BOREN -> HOTRM -> DAROM -> GALIM -> LLHA');
  expect(result.stderr).toContain('Aircraft: TEST');
});
