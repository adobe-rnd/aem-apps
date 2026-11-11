module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: {
    browser: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  rules: {
    'import/extensions': ['error', { js: 'always' }], // require js file extensions in imports
    'linebreak-style': ['error', 'unix'], // enforce unix linebreaks
    'no-param-reassign': [2, { props: false }], // allow modifying properties of param
    'import/no-cycle': 0, // Allow modules to use each other
  },
  overrides: [
    {
      files: ['test/**/*.js'],
      env: { node: true },
    },
    {
      files: ['tools/apps/schema-editor/core/**/*.js'],
      env: { browser: false, 'shared-node-browser': true },
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['../../**/*.js', '*:*'],
            message: 'Schema editor core is pure: it only imports other core modules.',
          }],
        }],
      },
    },
    {
      // Lit elements: `_` marks private members and reactive state.
      files: ['tools/apps/schema-editor/*.js', 'tools/apps/schema-editor/ui/**/*.js'],
      rules: {
        'no-underscore-dangle': 'off',
        'import/no-unresolved': ['error', { ignore: ['^da-lit$', '^https://'] }],
        'import/prefer-default-export': 'off',
        'class-methods-use-this': 'off',
      },
    },
  ],
};
