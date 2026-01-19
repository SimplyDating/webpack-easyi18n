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

function buildTemplateLiteralFromParts(parts) {
	// parts: Array<{type:'text', value:string} | {type:'expr', value: import('@babel/types').Expression}>
	const quasis = [];
	const expressions = [];
	let current = '';

	for (const part of parts) {
		if (part.type === 'text') {
			current += part.value;
			continue;
		}

		expressions.push(part.value);
		quasis.push(t.templateElement({ raw: current, cooked: current }, false));
		current = '';
	}

	quasis.push(t.templateElement({ raw: current, cooked: current }, true));
	return t.templateLiteral(quasis, expressions);
}

function buildTemplatePartsFromTranslation(translated, formatItems) {
	// formatItems: Array<string | import('@babel/types').Expression>
	const parts = [];
	let textBuf = '';
	const split = splitByPlaceholder(translated);
	for (const part of split) {
		if (part.type === 'text') {
			textBuf += part.value;
			continue;
		}

		const item = formatItems[part.index];
		if (typeof item === 'undefined') {
			textBuf += `%${part.index}`;
			continue;
		}
		if (typeof item === 'string') {
			textBuf += item;
			continue;
		}
		// expression
		if (textBuf) {
			parts.push({ type: 'text', value: textBuf });
			textBuf = '';
		}
		parts.push({ type: 'expr', value: item });
	}
	if (textBuf) parts.push({ type: 'text', value: textBuf });
	return parts;
}

function transformTemplateLiteralNuggets(node, state, fileNameForWarnings) {
	// Returns { changed: boolean, node: TemplateLiteral }
	const parts = [];
	for (let i = 0; i < node.quasis.length; i++) {
		parts.push({ type: 'text', value: node.quasis[i].value.cooked || '' });
		if (i < node.expressions.length) parts.push({ type: 'expr', value: node.expressions[i] });
	}

	let changed = false;
	const out = [];

	const emitMissing = (key) => {
		if (!state.warnOnMissingTranslations) return;
		if (typeof state.emitWarning === 'function') {
			state.emitWarning(new Error(`Missing translation${fileNameForWarnings ? ` in ${fileNameForWarnings}` : ''}.\n '${key}' : ${state.localeKey}`));
		}
	};

	let i = 0;
	while (i < parts.length) {
		const part = parts[i];
		if (part.type !== 'text' || part.value.indexOf(NUGGET_START) === -1) {
			out.push(part);
			i++;
			continue;
		}

		const startIdx = part.value.indexOf(NUGGET_START);
		const before = part.value.slice(0, startIdx);
		let rest = part.value.slice(startIdx + NUGGET_START.length);

		// Capture nugget content as parts until we see ]]].
		let captured = [];
		let j = i + 1;
		let remainderAfterEnd = '';
		let foundEnd = false;

		// The end marker may be inside the same quasi.
		const endInRest = rest.indexOf(NUGGET_END);
		if (endInRest !== -1) {
			const beforeEnd = rest.slice(0, endInRest);
			remainderAfterEnd = rest.slice(endInRest + NUGGET_END.length);
			if (beforeEnd) captured.push({ type: 'text', value: beforeEnd });
			foundEnd = true;
			j = i;
		} else {
			if (rest) captured.push({ type: 'text', value: rest });
		}

		while (!foundEnd && j < parts.length) {
			const p = parts[j];
			if (p.type === 'text') {
				const endIdx = p.value.indexOf(NUGGET_END);
				if (endIdx === -1) {
					captured.push(p);
					j++;
					continue;
				}
				// Split at end marker
				const beforeEnd = p.value.slice(0, endIdx);
				remainderAfterEnd = p.value.slice(endIdx + NUGGET_END.length);
				if (beforeEnd) captured.push({ type: 'text', value: beforeEnd });
				foundEnd = true;
				break;
			}
			captured.push(p);
			j++;
		}

		if (!foundEnd) {
			// Unclosed; leave original text intact.
			out.push(part);
			i++;
			continue;
		}

		if (before) out.push({ type: 'text', value: before });

		// Parse captured into key + format items, where format items may include expressions.
		// Sections are split by literal "|||" in text parts.
		const sections = [[]];
		for (const cp of captured) {
			if (cp.type === 'expr') {
				sections[sections.length - 1].push(cp);
				continue;
			}
			let text = cp.value;
			while (true) {
				const k = text.indexOf('|||');
				if (k === -1) {
					if (text) sections[sections.length - 1].push({ type: 'text', value: text });
					break;
				}
				const head = text.slice(0, k);
				if (head) sections[sections.length - 1].push({ type: 'text', value: head });
				sections.push([]);
				text = text.slice(k + 3);
			}
		}

		const keyParts = sections[0];
		const formatParts = sections.slice(1);

		// Build the translation key: concatenate text and map expressions to %0, %1, ...
		const keyValues = [];
		let key = '';
		for (const kp of keyParts) {
			if (kp.type === 'text') key += kp.value;
			else {
				const idx = keyValues.length;
				keyValues.push(kp.value);
				key += `%${idx}`;
			}
		}

		// Build format items array: each item is either a string (from only-text) or an expression.
		const formatItems = [];
		for (const fp of formatParts) {
			const onlyText = fp.every(x => x.type === 'text');
			if (onlyText) {
				formatItems.push(fp.map(x => x.value).join(''));
				continue;
			}
			// If it contains expressions, only support a single expression item for now.
			const expr = fp.find(x => x.type === 'expr');
			if (expr) formatItems.push(expr.value);
			else formatItems.push(fp.map(x => x.value).join(''));
		}

		// If key contained expressions, they become part of key; treat them as format items too.
		// (No "|||" list case.)
		const finalFormatItems = formatItems.length > 0 ? formatItems : keyValues;

		const translated = getTranslation({
			localePoPath: state.localePoPath,
			alwaysRemoveBrackets: state.alwaysRemoveBrackets,
			translationLookup: state.translationLookup,
			key,
			rawKey: key,
		});

		let replacementText = translated;
		if (replacementText == null) {
			if (state.localePoPath != null) emitMissing(key);
			if (state.localePoPath == null && !state.alwaysRemoveBrackets) {
				// leave original nugget intact
				out.push({ type: 'text', value: NUGGET_START });
				out.push(...captured);
				out.push({ type: 'text', value: NUGGET_END });
				if (remainderAfterEnd) out.push({ type: 'text', value: remainderAfterEnd });
				i = j + 1;
				continue;
			}
			replacementText = key;
		}

		changed = true;
		out.push(...buildTemplatePartsFromTranslation(replacementText, finalFormatItems));
		if (remainderAfterEnd) out.push({ type: 'text', value: remainderAfterEnd });
		i = j + 1;
	}

		if (!changed) return { changed: false, node };
		return { changed: true, node: buildTemplateLiteralFromParts(out) };
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

	// React/JSX nugget support notes:
	// - In JSX, text is NOT a single string at runtime/source level. It's a list of children:
	//   JSXText nodes, JSXExpressionContainer nodes (e.g. {foo}, {" "}), and JSXElement nodes.
	// - Nuggets can span multiple children, e.g.:
	//     [[[Hello {name} <b>world</b>]]]
	// - For "raw-key" matching we must reproduce the exact key that shows up in translationLookup
	//   (e.g. the keys produced by webpack-easyi18n-temp). That includes the original source text
	//   for embedded nodes like {changeStatusBtn} / {" "} and <button ...>...</button>, including
	//   formatting and newlines.
	// - For emitting output we support two styles of translation values:
	//   (1) Placeholder-based: translated string contains %0, %1 ...; we reinsert captured nodes.
	//   (2) Raw JSX-based: translated string contains literal JSX/expressions; we parse it as JSX
	//       and inject those AST children directly.

	// Returns the original source text for a node (used to build raw-key strings).
	const getSourceSliceForNode = (node) => {
		if (!node || state.source == null) return null;
		if (typeof node.start !== 'number' || typeof node.end !== 'number') return null;
		return state.source.slice(node.start, node.end);
	};

	const parseTranslatedJsxChildren = (translated) => {
		// Used for raw JSX translation values.
		// Example translation value:
		//   "Просто{\" \"}<button onClick={onClick}>нажмите</button>"
		// We parse it as JSX and splice the resulting children into the output.
		// Parse translation as JSX so translations can include markup like <button ...>...</button>
		// and expression containers like {" "}.
		try {
			// Wrap in a fragment so we can accept multiple top-level children.
			const expr = parser.parseExpression(`<>${translated}</>`, {
				plugins: ['jsx', 'typescript', 'classProperties'],
			});
			if (t.isJSXFragment(expr)) return expr.children;
			if (t.isJSXElement(expr)) return [expr];
		} catch {
			// Caller decides how to fall back.
		}
		return null;
	};

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

		// Begin capturing one nugget.
		// - rawKeyText: exact (source-derived) key contents inside [[[...]]]
		// - templateText: placeholder skeleton used to re-emit original content when we need to
		//   remove brackets but have no translation. Each embedded node becomes %N and we capture the
		//   corresponding node/expression in `values[N]`.
		let rawKeyText = '';
		let templateText = '';
		const values = [];
		let done = false;

		// Seed with remaining text after [[[ in the starting node.
		let seed = afterStart;
		let localIndex = i;

		const consumeText = (text) => {
			if (!text) return;
			const endIdx = text.indexOf(NUGGET_END);
			if (endIdx === -1) {
				templateText += text;
				rawKeyText += text;
				return { done: false };
			}
			templateText += text.slice(0, endIdx);
			rawKeyText += text.slice(0, endIdx);
			const remainder = text.slice(endIdx + NUGGET_END.length);
			return { done: true, remainder };
		};

		// Fast path: the closing marker (]]]) is in the same JSXText that opened the nugget.
		{
			const res = consumeText(seed);
			if (res.done) {
				// Entire nugget is within the first JSXText.
				const rawKey = normalizeKey(rawKeyText);
				const translated = getTranslation({
					localePoPath: state.localePoPath,
					alwaysRemoveBrackets: state.alwaysRemoveBrackets,
					translationLookup: state.translationLookup,
					key: rawKey,
					rawKey,
				});

				if (translated == null) {
					if (state.localePoPath != null && state.warnOnMissingTranslations) emitMissing(rawKey);
					if (state.localePoPath == null && !state.alwaysRemoveBrackets) {
						// Leave original unmodified
						out.push(child);
						i++;
						continue;
					}
					out.push(...buildJsxChildrenFromTranslation(templateText, values));
					if (res.remainder) out.push(t.jsxText(res.remainder));
					i++;
					continue;
				}

				if (/%\d+/.test(translated)) {
					out.push(...buildJsxChildrenFromTranslation(translated, values));
				} else {
					const parsedChildren = parseTranslatedJsxChildren(translated);
					if (parsedChildren != null) out.push(...parsedChildren);
					else out.push(t.jsxText(translated));
				}
				if (res.remainder) out.push(t.jsxText(res.remainder));
				i++;
				continue;
			}
		}

		// Slow path: the nugget spans multiple JSX children; keep consuming until we find ]]]
		// in a later JSXText node.
		localIndex = i + 1;

		while (localIndex < children.length) {
			const current = children[localIndex];

			if (t.isJSXText(current)) {
				const res = consumeText(current.value);
				if (res.done) {
					done = true;
					// Finish: translate and emit remainder
					const rawKey = normalizeKey(rawKeyText);
					const translated = getTranslation({
						localePoPath: state.localePoPath,
						alwaysRemoveBrackets: state.alwaysRemoveBrackets,
						translationLookup: state.translationLookup,
						key: rawKey,
						rawKey,
					});

					if (translated == null) {
						if (state.localePoPath != null && state.warnOnMissingTranslations) emitMissing(rawKey);
						if (state.localePoPath == null && !state.alwaysRemoveBrackets) {
							// Leave original sequence unmodified
							out.push(child);
							for (let k = i + 1; k <= localIndex; k++) out.push(children[k]);
							i = localIndex + 1;
							continue;
						}

						out.push(...buildJsxChildrenFromTranslation(templateText, values));
					} else {
						if (/%\d+/.test(translated)) {
							out.push(...buildJsxChildrenFromTranslation(translated, values));
						} else {
							const parsedChildren = parseTranslatedJsxChildren(translated);
							if (parsedChildren != null) out.push(...parsedChildren);
							else out.push(t.jsxText(translated));
						}
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
				// The raw key wants the exact source representation (e.g. {" "}, {foo}).
				// The template wants a placeholder to preserve the original child ordering.
				{
					const slice = getSourceSliceForNode(current);
					if (slice != null) rawKeyText += slice;
				}
				const index = values.length;
				values.push(current.expression);
				templateText += `%${index}`;
				localIndex++;
				continue;
			}

			if (t.isJSXElement(current) || t.isJSXFragment(current)) {
				// Same strategy for nested elements/fragments (e.g. <button>...</button>):
				// - rawKeyText captures the exact source slice
				// - templateText captures a %N placeholder
				{
					const slice = getSourceSliceForNode(current);
					if (slice != null) rawKeyText += slice;
				}
				const index = values.length;
				values.push(current);
				templateText += `%${index}`;
				localIndex++;
				continue;
			}

			// Other child types: keep them as placeholders to avoid losing content.
			{
				const slice = getSourceSliceForNode(current);
				if (slice != null) rawKeyText += slice;
			}
			const index = values.length;
			values.push(current);
			templateText += `%${index}`;
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
		source,
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
			// React support: rewrite nuggets at the JSX AST level so we can preserve embedded
			// expressions/elements as real AST nodes (not string concatenations).
			path.node.children = transformJsxNuggets(path.node.children, state, options.fileNameForWarnings);
		},
		JSXFragment(path) {
			// Same as JSXElement, but for fragments: <>...</>
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
			const res = transformTemplateLiteralNuggets(path.node, state, options.fileNameForWarnings);
			if (res.changed) {
				path.replaceWith(res.node);
				path.skip();
				return;
			}

			// Fallback: allow nuggets entirely inside a quasi.
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
