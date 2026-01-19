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

	test('formats template literal nuggets with expression format items', () => {
		const input = "const n = 1; documentWriteLn(`[[[Online favourites (%0)|||${n}]]]`);";
		const out = transformSource(input, {
			localeKey: 'en-gb',
			localePoPath: null,
			alwaysRemoveBrackets: true,
			warnOnMissingTranslations: true,
			translationLookup: null,
		});

		// Should strip nugget syntax and apply %0 formatting using the template expression.
		expect(out).toContain('Online favourites');
		expect(out).toContain('${n}');
		expect(out).not.toContain('[[[');
		expect(out).not.toContain('|||');
	});

	test('formats translated template literal nuggets with expression format items', () => {
		const input = "const n = 2; documentWriteLn(`[[[Online favourites (%0)|||${n}]]]`);";
		const out = transformSource(input, {
			localeKey: 'xx',
			localePoPath: 'dummy.po',
			alwaysRemoveBrackets: true,
			warnOnMissingTranslations: true,
			translationLookup: {
				'Online favourites (%0)': 'Favourites online: %0',
			},
		});

		expect(out).toContain('Favourites online:');
		expect(out).toContain('${n}');
		expect(out).not.toContain('[[[');
	});
});
