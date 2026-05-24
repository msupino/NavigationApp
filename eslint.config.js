export default [{
  files: ['docs/**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
  rules: {
    // 'vars: local' skips top-level functions — this codebase shares them
    // across docs/*.js scripts, so they look unused to a single-file linter.
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    'no-undef': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-dupe-else-if': 'error',
    'no-cond-assign': 'error',
    'no-irregular-whitespace': 'error',
    'no-self-assign': 'error',
    'no-self-compare': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
  },
}];
