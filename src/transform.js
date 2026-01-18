const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generate = require('@babel/generator').default;

const NUGGET_START = '[[[';
const NUGGET_END = ']]]';

function normalizeKey(value) {
	if (typeof value !== 'string') return value;
	// .po files use \n; source may have CRLF
	return value.replace(/\r\n/g, '\n');
}

function getTranslation({ localePoPath, alwaysRemoveBrackets, translationLookup, key, rawKey }) {
	if (localePoPath == null) {
		if (alwaysRemoveBrackets) return rawKey;
		return null;
	}

	if (!translationLookup) return null;
	const normalized = normalizeKey(key);
	const normalizedRaw = normalizeKey(rawKey);
	let value = translationLookup[normalized];
	if (typeof value === 'undefined') value = translationLookup[normalizedRaw];
	if (typeof value === 'undefined' || value === '') return null;
	return value;
}

function splitByPlaceholder(text) {
	// Returns array of {type:'text', value} or {type:'ph', index}
	const parts = [];
	const re = /(%\d+)/g;
	let last = 0;
	let match;
	while ((match = re.exec(text)) != null) {
		if (match.index > last) {
			parts.push({ type: 'text', value: text.slice(last, match.index) });
		}
		const index = Number(match[1].slice(1));
		parts.push({ type: 'ph', index });
		last = match.index + match[1].length;
	}
	if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
	return parts;
}

function normalizeJsxTextForKey(text) {
	// Make translation keys resilient to formatting/indentation inside JSX.
	// React itself collapses most whitespace in JSXText; we mirror that for keys.
	return text.replace(/\s+/g, ' ');
}

function replaceNuggetsInPlainString(input, { localePoPath, alwaysRemoveBrackets, warnOnMissingTranslations, translationLookup, onMissing }) {
	if (typeof input !== 'string' || input.indexOf(NUGGET_START) === -1) return input;

	// Note: this regex intentionally does NOT attempt to parse format items across multiple groups.
	const regex = /\[\[\[(.+?)(?:\|\|\|.+?)*(?:\/\/\/(.+?))?\]\]\]/gs;

	return input.replace(regex, (originalText, nuggetSyntaxRemoved) => {
		const rawKey = nuggetSyntaxRemoved;
		const translated = getTranslation({
			localePoPath,
			alwaysRemoveBrackets,
			translationLookup,
			key: nuggetSyntaxRemoved,
			rawKey,
		});

		if (translated == null) {
			if (localePoPath != null && warnOnMissingTranslations && typeof onMissing === 'function') {
				onMissing(rawKey);
			}
			if (localePoPath == null && !alwaysRemoveBrackets) return originalText;
			return rawKey;
		}

		let replacement = translated;

		// Format nuggets: [[[Hello %0|||A|||B]]]
		const formatItemsMatch = originalText.match(/\|\|\|(.+?)(?:\/\/\/.+?)?\]\]\]/s);
		if (formatItemsMatch) {
			const formatItems = formatItemsMatch[1].split('|||');
			replacement = replacement.replace(/(%\d+)/g, (value) => {
				const identifier = Number(value.slice(1));
				if (!Number.isNaN(identifier) && formatItems.length > identifier) return formatItems[identifier];
				return value;
			});
		}

		return replacement;
	});
}

function transformJsxNuggets(children, state, fileNameForWarnings) {
	const out = [];
	let i = 0;

	const emitMissing = (key) => {
		if (!state.warnOnMissingTranslations) return;
		if (typeof state.emitWarning === 'function') {
			state.emitWarning(new Error(`Missing translation${fileNameForWarnings ? ` in ${fileNameForWarnings}` : ''}.\n '${key}' : ${state.localeKey}`));
		}
	};

	while (i < children.length) {
		const child = children[i];

		// We only start nuggets from JSXText containing [[[.
		if (!t.isJSXText(child) || child.value.indexOf(NUGGET_START) === -1) {
			out.push(child);
			i++;
			continue;
		}

		const startIndex = child.value.indexOf(NUGGET_START);
		const before = child.value.slice(0, startIndex);
		const afterStart = child.value.slice(startIndex + NUGGET_START.length);

		if (before) out.push(t.jsxText(before));

		// Begin capturing nugget content across subsequent children.
		let message = '';
		const values = [];
		let done = false;

		// Seed with remaining text after [[[ in the starting node.
		let seed = afterStart;
		let localIndex = i;

		const consumeText = (text) => {
			if (!text) return;
			const endIdx = text.indexOf(NUGGET_END);
			if (endIdx === -1) {
				message += normalizeJsxTextForKey(text);
				return { done: false };
			}
			message += normalizeJsxTextForKey(text.slice(0, endIdx));
			const remainder = text.slice(endIdx + NUGGET_END.length);
			return { done: true, remainder };
		};

		// Consume seed (which may contain ]]]).
		{
			const res = consumeText(seed);
			if (res.done) {
				// Entire nugget is within the first JSXText.
				const keyRaw = message;
				const key = keyRaw;
				const translated = getTranslation({
					localePoPath: state.localePoPath,
					alwaysRemoveBrackets: state.alwaysRemoveBrackets,
					translationLookup: state.translationLookup,
					key,
					rawKey: keyRaw,
				});

				if (translated == null) {
					if (state.localePoPath != null && state.warnOnMissingTranslations) emitMissing(keyRaw);
					if (state.localePoPath == null && !state.alwaysRemoveBrackets) {
						// Leave original unmodified
						out.push(child);
						i++;
						continue;
					}
					out.push(t.jsxText(keyRaw + res.remainder));
					i++;
					continue;
				}

				out.push(...buildJsxChildrenFromTranslation(translated, values));
				if (res.remainder) out.push(t.jsxText(res.remainder));
				i++;
				continue;
			}
		}

		localIndex = i + 1;

		while (localIndex < children.length) {
			const current = children[localIndex];

			if (t.isJSXText(current)) {
				const res = consumeText(current.value);
				if (res.done) {
					done = true;
					// Finish: translate and emit remainder
					const keyRaw = message;
					const key = keyRaw;
					const translated = getTranslation({
						localePoPath: state.localePoPath,
						alwaysRemoveBrackets: state.alwaysRemoveBrackets,
						translationLookup: state.translationLookup,
						key,
						rawKey: keyRaw,
					});

					if (translated == null) {
						if (state.localePoPath != null && state.warnOnMissingTranslations) emitMissing(keyRaw);
						if (state.localePoPath == null && !state.alwaysRemoveBrackets) {
							// Leave original sequence unmodified
							out.push(child);
							for (let k = i + 1; k <= localIndex; k++) out.push(children[k]);
							i = localIndex + 1;
							continue;
						}

						out.push(...buildJsxChildrenFromTranslation(keyRaw, values));
					} else {
						out.push(...buildJsxChildrenFromTranslation(translated, values));
					}

					if (res.remainder) out.push(t.jsxText(res.remainder));
					i = localIndex + 1;
					break;
				}

				localIndex++;
				continue;
			}

			if (t.isJSXExpressionContainer(current)) {
				// Ignore empty expressions (comments)
				if (t.isJSXEmptyExpression(current.expression)) {
					localIndex++;
					continue;
				}
				const index = values.length;
				values.push(current.expression);
				message += `%${index}`;
				localIndex++;
				continue;
			}

			if (t.isJSXElement(current) || t.isJSXFragment(current)) {
				const index = values.length;
				values.push(current);
				message += `%${index}`;
				localIndex++;
				continue;
			}

			// Other child types: keep them as placeholders to avoid losing content.
			const index = values.length;
			values.push(current);
			message += `%${index}`;
			localIndex++;
		}

		if (!done) {
			// Unclosed nugget: leave original child
			out.push(child);
			i++;
		}
	}

	return out;
}

function buildJsxChildrenFromTranslation(translated, values) {
	const parts = splitByPlaceholder(translated);
	const out = [];
	for (const part of parts) {
		if (part.type === 'text') {
			if (part.value) out.push(t.jsxText(part.value));
			continue;
		}

		const value = values[part.index];
		if (typeof value === 'undefined') {
			out.push(t.jsxText(`%${part.index}`));
			continue;
		}

		if (t.isJSXElement(value) || t.isJSXFragment(value)) {
			out.push(value);
			continue;
		}

		// Expressions must be wrapped
		out.push(t.jsxExpressionContainer(value));
	}

	return out;
}

function transformSource(source, options = {}) {
	const state = {
		localeKey: options.localeKey || '',
		localePoPath: options.localePoPath ?? null,
		alwaysRemoveBrackets: Boolean(options.alwaysRemoveBrackets),
		warnOnMissingTranslations: options.warnOnMissingTranslations !== false,
		translationLookup: options.translationLookup || null,
		emitWarning: options.emitWarning,
	};

	const ast = parser.parse(source, {
		sourceType: 'unambiguous',
		plugins: [
			'jsx',
			'typescript',
			'classProperties',
			'objectRestSpread',
			'optionalChaining',
			'nullishCoalescingOperator',
			'dynamicImport',
			'topLevelAwait',
			'importMeta',
		],
	});

	traverse(ast, {
		JSXElement(path) {
			path.node.children = transformJsxNuggets(path.node.children, state, options.fileNameForWarnings);
		},
		JSXFragment(path) {
			path.node.children = transformJsxNuggets(path.node.children, state, options.fileNameForWarnings);
		},
		StringLiteral(path) {
			const before = path.node.value;
			const after = replaceNuggetsInPlainString(before, {
				...state,
				onMissing: (key) => {
					if (state.emitWarning) state.emitWarning(new Error(`Missing translation${options.fileNameForWarnings ? ` in ${options.fileNameForWarnings}` : ''}.\n '${key}' : ${state.localeKey}`));
				},
			});
			if (after !== before) path.node.value = after;
		},
		TemplateLiteral(path) {
			for (const quasi of path.node.quasis) {
				const before = quasi.value.cooked;
				if (typeof before !== 'string') continue;
				const after = replaceNuggetsInPlainString(before, {
					...state,
					onMissing: (key) => {
						if (state.emitWarning) state.emitWarning(new Error(`Missing translation${options.fileNameForWarnings ? ` in ${options.fileNameForWarnings}` : ''}.\n '${key}' : ${state.localeKey}`));
					},
				});
				if (after !== before) {
					quasi.value.cooked = after;
					quasi.value.raw = after;
				}
			}
		},
	});

	const output = generate(ast, {
		jsescOption: { minimal: true },
		retainLines: true,
	}, source);

	return output.code;
}

module.exports = {
	transformSource,
	replaceNuggetsInPlainString,
	transformJsxNuggets,
	buildJsxChildrenFromTranslation,
};
