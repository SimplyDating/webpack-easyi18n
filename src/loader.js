const { transformSource } = require('./transform');

module.exports = function easyI18nLoader(source) {
	const callback = this.async();
	const options = this.getOptions ? this.getOptions() : {};

	try {
		const code = transformSource(source.toString(), {
			localeKey: options.localeKey,
			localePoPath: options.localePoPath,
			alwaysRemoveBrackets: options.alwaysRemoveBrackets,
			warnOnMissingTranslations: options.warnOnMissingTranslations,
			translationLookup: options.translationLookup,
			fileNameForWarnings: this.resourcePath,
			emitWarning: (err) => this.emitWarning(err),
		});

		callback(null, code);
	} catch (err) {
		callback(err);
	}
};
