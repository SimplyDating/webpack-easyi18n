const path = require('path');
const { mkdtempSync, readFileSync } = require('fs');
const os = require('os');
const webpack = require('webpack');

const EasyI18nPlugin = require('../src');

function runWebpack(config) {
	return new Promise((resolve, reject) => {
		webpack(config, (err, stats) => {
			if (err) return reject(err);
			if (stats.hasErrors()) {
				const info = stats.toJson({ all: false, errors: true, warnings: true });
				return reject(new Error(info.errors.map(e => e.message || e).join('\n\n')));
			}
			resolve(stats);
		});
	});
}

describe('webpack integration', () => {
	jest.setTimeout(60_000);

	test('injects loader and translates JSX-spanning nuggets', async () => {
		const outDir = mkdtempSync(path.join(os.tmpdir(), 'webpack-easyi18n-out-'));
		const repoRoot = path.join(__dirname, '..');
		const entry = path.join(__dirname, 'fixtures', 'react', 'index.jsx');
		const localesPath = path.join(__dirname, 'fixtures', 'locales');

		const config = {
			mode: 'development',
			context: repoRoot,
			devtool: false,
			entry,
			output: {
				path: outDir,
				filename: 'bundle.js',
			},
			resolve: {
				extensions: ['.js', '.jsx'],
			},
			module: {
				rules: [
					{
						test: /\.[jt]sx?$/,
						exclude: /node_modules/,
						use: {
							loader: path.join(__dirname, 'utils', 'babel-test-loader.js'),
						},
					},
				],
			},
			plugins: [
				new EasyI18nPlugin(['xx', 'messages.po'], {
					localesPath,
					alwaysRemoveBrackets: true,
					warnOnMissingTranslations: true,
				}),
			],
		};

		await runWebpack(config);
		const bundle = readFileSync(path.join(outDir, 'bundle.js'), 'utf8');

		expect(bundle).toContain('To change your status and immediately send a chat request');
		// Proof the placeholder became a real expression, not string-concatenated output.
		expect(bundle).toContain('changeStatusBtn');
		// Nuggets should not remain in output.
		expect(bundle).not.toContain('[[[');
		expect(bundle).not.toContain(']]]');
	});
});
