// eslint-disable-next-line import/extensions -- the package exports this subpath without one
const { rules: airbnbStyle } = require('eslint-config-airbnb-base/rules/style');

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
        'import/no-restricted-paths': ['error', {
          basePath: __dirname,
          zones: [{
            target: './tools/apps/schema-editor/core',
            from: './',
            except: ['./tools/apps/schema-editor/core'],
            message: 'Schema editor core is pure: it only imports other core modules.',
          }],
        }],
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['*:*'],
            message: 'Schema editor core is pure: it does not load modules from the network.',
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
        'no-restricted-syntax': [...airbnbStyle['no-restricted-syntax'], {
          selector: ':matches(Literal[value=/da\\.live.nx2/], TemplateElement[value.raw=/da\\.live.nx2/])',
          message: 'Load nx2 through `getNx2()` (ui/shared/nx.js): nx2 is expected to become nx.',
        }],
      },
    },
  ],
};
