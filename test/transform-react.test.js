const { readFileSync } = require('fs');
const path = require('path');
const { transformSource } = require('../src/transform');

describe('transformSource JSX nuggets', () => {
	const fixture = readFileSync(path.join(__dirname, 'fixtures', 'react', 'App.jsx'), 'utf8');

	test('replaces JSX nugget spanning expression containers', () => {
		const translationLookup = {
			'Just %0 to change your status and immediately send a chat request.':
				'To change your status and immediately send a chat request, %0.',
		};

		const out = transformSource(fixture, {
			localeKey: 'xx',
			localePoPath: 'dummy.po',
			alwaysRemoveBrackets: true,
			warnOnMissingTranslations: true,
			translationLookup,
		});

		expect(out).toContain('To change your status and immediately send a chat request,');
		// The placeholder should be replaced by a JSX expression container in output, not left as %0.
		expect(out).toContain('{changeStatusBtn}');
		expect(out).not.toContain('%0');
		expect(out).not.toContain('[[[');
		expect(out).not.toContain(']]]');
	});

	test('supports JSX element placeholders inside nuggets', () => {
		const translationLookup = {
			// Key is whitespace-normalized (newlines/indentation collapse to single spaces).
			'Just %0%1%2 to change your status and immediately send a chat request.':
				'Click %1%0%2 to change your status and immediately send a chat request.',
			// Also support the no-space variant, depending on author formatting.
			'Just %0%1%2to change your status and immediately send a chat request.':
				'Click %1%0%2to change your status and immediately send a chat request.',
		};

		const out = transformSource(fixture, {
			localeKey: 'xx',
			localePoPath: 'dummy.po',
			alwaysRemoveBrackets: true,
			warnOnMissingTranslations: true,
			translationLookup,
		});

		expect(out).toContain('Click');
		expect(out).toContain('<button');
		expect(out).toContain('onClick={onChangeStatusBtnClicked}');
		expect(out).not.toContain('[[[');
	});
});
