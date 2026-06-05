#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'docs', 'data', 'leg-altitude.json');

function directionPoolFromSegments(segments) {
  const out = [];
  for (const segment of segments || []) {
    if (!segment || typeof segment.from !== 'string' || typeof segment.to !== 'string') {
      continue;
    }
    if (Number.isInteger(segment.inboundAltitude)) {
      out.push({
        from: segment.from,
        to: segment.to,
        altitude: segment.inboundAltitude,
        segment: segment.from + '-' + segment.to,
        field: 'inboundAltitude',
      });
    }
    if (Number.isInteger(segment.outboundAltitude)) {
      out.push({
        from: segment.to,
        to: segment.from,
        altitude: segment.outboundAltitude,
        segment: segment.from + '-' + segment.to,
        field: 'outboundAltitude',
      });
    }
  }
  return out;
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.directionPool = directionPoolFromSegments(data.segments);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log('synced', data.directionPool.length, 'directed altitude entries');
