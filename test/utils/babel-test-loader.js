const babel = require('@babel/core');

module.exports = function babelTestLoader(source, inputSourceMap) {
	const callback = this.async();
	try {
		const result = babel.transformSync(source, {
			filename: this.resourcePath,
			babelrc: false,
			configFile: false,
			sourceMaps: false,
			inputSourceMap: inputSourceMap || undefined,
			presets: [
				['@babel/preset-env', { targets: { node: 'current' } }],
				['@babel/preset-react', { runtime: 'automatic' }],
			],
		});
		callback(null, result ? result.code : source);
	} catch (err) {
		callback(err);
	}
};
