const { transformSource } = require('../src/transform');

describe('transformSource plain string nuggets', () => {
	test('removes brackets for default locale when alwaysRemoveBrackets is true', () => {
		const input = "documentWriteLn(`[[[Two\nlines]]]`);";
		const out = transformSource(input, {
			localeKey: 'en-gb',
			localePoPath: null,
			alwaysRemoveBrackets: true,
			warnOnMissingTranslations: true,
			translationLookup: null,
		});

			expect(out).toContain('Two\nlines');
		expect(out).not.toContain('[[[');
	});
});
