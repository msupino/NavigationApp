// scripts/build-aviation-feeds.mjs checks `process.argv` at import to see whether it was run as
// a command. Workers with nodejs_compat have `process`; this makes sure, and runs first.
if (typeof globalThis.process === 'undefined') globalThis.process = { argv: [], env: {}, exitCode: 0 };
else if (!Array.isArray(globalThis.process.argv)) globalThis.process.argv = [];
