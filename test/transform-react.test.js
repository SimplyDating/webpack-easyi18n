const { readFileSync } = require('fs');
const path = require('path');
const { transformSource } = require('../src/transform');

describe('transformSource JSX nuggets', () => {
	const fixture = readFileSync(path.join(__dirname, 'fixtures', 'react', 'App.jsx'), 'utf8');
	const normalize = (s) => s.replace(/\r\n/g, '\n');
	const allNuggets = Array.from(fixture.matchAll(/\[\[\[([\s\S]*?)\]\]\]/g)).map(m => normalize(m[1]));

	test('replaces JSX nugget spanning expression containers', () => {
		const keyRaw = allNuggets[0];
		const translationLookup = {
			[keyRaw]:
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
		const keyRaw = allNuggets[1];
		const translationLookup = {
			[keyRaw]:
				'Click %1%0%2 to change your status and immediately send a chat request.',
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

	test('matches webpack-easyi18n-temp raw key (raw JSX + {" "} + newlines) and replaces nugget', () => {
		// Build this without template-literal indentation so the nugget content matches the
		// exact key observed in webpack-easyi18n-temp.
		const source = [
			"import React from 'react';",
			'export function Warn({ onChangeStatusBtnClicked }) {',
			'\treturn (',
			'\t\t<div className="not-online-warning">',
			'\t\t\t[[[Your online status must be "Available" to start a chat. Just{" "}',
			'          <button',
			'            className="btn"',
			'            type="button"',
			'            onClick={onChangeStatusBtnClicked}',
			'          >',
			'            click here',
			'          </button>{" "}',
			'          to change your status and immediately send a chat request.]]]',
			'\t\t</div>',
			'\t);',
			'}',
		].join('\n');

		// This key shape matches what was observed in webpack-easyi18n-temp (includes {" "},\n, and raw <button> markup).
		const translationLookup = {
			'Your online status must be "Available" to start a chat. Just{" "}\n          <button\n            className="btn"\n            type="button"\n            onClick={onChangeStatusBtnClicked}\n          >\n            click here\n          </button>{" "}\n          to change your status and immediately send a chat request.':
				'Для начала чата ваш статус в сети должен быть «Доступен». Просто{" "}<button\n            className="btn"\n            type="button"\n            onClick={onChangeStatusBtnClicked}\n          >нажмите здесь</button>, чтобы изменить свой статус и немедленно отправить запрос на чат.',
		};

		const out = transformSource(source, {
			localeKey: 'ru',
			localePoPath: 'dummy.po',
			alwaysRemoveBrackets: false,
			warnOnMissingTranslations: false,
			translationLookup,
		});

		expect(out).toContain('Для начала чата');
		expect(out).toContain('нажмите здесь');
		expect(out).toContain('onClick={onChangeStatusBtnClicked}');
		expect(out).not.toContain('[[[');
		expect(out).not.toContain(']]]');
		expect(out).not.toContain('Your online status must be');
	});
});
