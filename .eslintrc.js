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
      files: ['tools/apps/graphql/core/**/*.js'],
      env: { browser: false, 'shared-node-browser': true },
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['../**/*.js', '!../../../deps/graphql/**/*.js', '*:*'],
            message: 'GraphQL core only imports core modules and the bundled graphql dependency.',
          }],
        }],
      },
    },
  ],
};
