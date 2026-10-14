import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({})

// package.json has "type": "module", so every .js file is ESM (the base config assumes CommonJS scripts)
export default [
	...baseConfig,
	{ files: ['**/*.js', '**/*.mjs'], languageOptions: { sourceType: 'module' } },
	// Dev-only scripts: module.register swaps in the InstanceBase stub, and the harness is a CLI with an exit code
	{
		files: ['test/**'],
		rules: { 'n/no-unsupported-features/node-builtins': 'off', 'n/no-process-exit': 'off' },
	},
]
