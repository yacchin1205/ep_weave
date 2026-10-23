'use strict';

module.exports = [
  {ignores: ['lib/**', 'static/**', 'embedding/**', 'tests/nbsearch/**']},
  ...require('eslint-config-etherpad/flat/plugin'),
  {files: ['src/pad/static/js/embedding-worker.js'], languageOptions: {sourceType: 'module'}},
];
