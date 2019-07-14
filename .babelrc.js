module.exports = api => {
  api.cache(true)

  return {
    plugins: [
      [
        '@babel/plugin-proposal-class-properties',
        {
          loose: true
        }
      ],
      [
        '@babel/plugin-proposal-pipeline-operator',
        {
          proposal: 'minimal'
        }
      ],
      [
        '@babel/plugin-proposal-do-expressions'
      ],
      [
        '@babel/plugin-proposal-nullish-coalescing-operator'
      ],
      [
        '@babel/plugin-proposal-optional-chaining'
      ],
      [
        '@babel/plugin-proposal-partial-application'
      ],
      [
        '@babel/plugin-proposal-throw-expressions'
      ],
      [
        '@babel/plugin-syntax-bigint'
      ]
    ],
    presets: [
      [
        '@babel/preset-env',
        {
          corejs: 3,
          useBuiltIns: 'usage',
          targets: {
            node: 'current'
          }
        }
      ]
    ]
  }
}
