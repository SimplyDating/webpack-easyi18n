const path = require("path");
const {
    readFileSync,
    writeFileSync,
    mkdirSync
} = require("fs");

async function loadGettextToI18next() {
	// i18next-conv@16+ is ESM-only (and Node>=20). Requiring it from CommonJS breaks Jest with
	// "Unexpected token 'export'". We support both:
	// - CJS: require('i18next-conv').gettextToI18next
	// - ESM: (await import('i18next-conv')).gettextToI18next
	try {
		// eslint-disable-next-line global-require
		const mod = require('i18next-conv');
		return mod.gettextToI18next || mod.gettextToI18Next || mod.default;
	} catch (err) {
		// If it's ESM-only, fall back to dynamic import.
		const mod = await import('i18next-conv');
		return mod.gettextToI18next || mod.gettextToI18Next || mod.default;
	}
}

class EasyI18nPlugin {
    static defaultOptions = {
        alwaysRemoveBrackets: false,
        warnOnMissingTranslations: true,
        excludeUrls: null,
        includeUrls: null,
    };

    static escapeNuggets = (string) => {
        return string
            .replace(/\\/g, `\\\\`) // escape backslashes
            .replace(/'/g, `\\'`) // escape single quotes
            .replace(/"/g, `\\"`); // escape double quotes
    }

    constructor(locale, options = {}) {
        this.locale = locale;
        this.options = {
            ...EasyI18nPlugin.defaultOptions,
            ...options
        };

		this.translationLookup = null;
    }

    apply(compiler) {
        const mkdir = (dirPath) => {
            try {
                mkdirSync(dirPath);
            } catch (err) {
                if (err.code !== "EEXIST") throw err;
            }
        };

		const localeKey = this.locale[0];
		const localePoPath = this.locale[1];

		const prepareTranslations = async () => {
			if (localePoPath === null) {
				this.translationLookup = null;
				return;
			}

			const poPath = path.join(this.options.localesPath, localePoPath);
			mkdir(path.resolve(path.join(this.options.localesPath, "/webpack-easyi18n-temp/")));

			const gettextToI18next = await loadGettextToI18next();
			if (typeof gettextToI18next !== 'function') {
				throw new Error('Failed to load i18next-conv gettextToI18next()');
			}

			// Keep the temp json file behavior for backward-compatibility/debugging.
			const lookupData = await gettextToI18next(localeKey, readFileSync(poPath), {});
			const translationLookupPath = path.join(this.options.localesPath, `/webpack-easyi18n-temp/${localeKey}.json`);
			writeFileSync(translationLookupPath, lookupData);

			try {
				this.translationLookup = typeof lookupData === 'string' ? JSON.parse(lookupData) : lookupData;
			} catch {
				// Fallback to requiring the generated file.
				// eslint-disable-next-line global-require, import/no-dynamic-require
				this.translationLookup = require(translationLookupPath);
			}
		};

		compiler.hooks.beforeCompile.tapPromise('EasyI18nPlugin', prepareTranslations);
		compiler.hooks.watchRun.tapPromise('EasyI18nPlugin', prepareTranslations);

		// Inject our loader so nuggets are transformed at source-level (before Babel turns JSX into string concatenations).
		compiler.hooks.normalModuleFactory.tap('EasyI18nPlugin', (normalModuleFactory) => {
			normalModuleFactory.hooks.afterResolve.tap('EasyI18nPlugin', (resolveData) => {
				if (!resolveData) return;

				// webpack 5 can expose resource on different fields depending on stage.
				const resourcePath = resolveData.resource
					|| (resolveData.resourceResolveData && resolveData.resourceResolveData.path)
					|| (resolveData.createData && resolveData.createData.resource);
				if (!resourcePath) return;

				// Skip dependencies
				if (resourcePath.includes(`${path.sep}node_modules${path.sep}`)) return;

				// Only transform JS/TS sources.
				if (!/\.[cm]?[jt]sx?$/.test(resourcePath)) return;

				// Apply include/exclude patterns against the full resource path.
				if (this.options.excludeUrls != null && this.options.excludeUrls.some(excludedUrl => resourcePath.includes(excludedUrl))) return;
				if (this.options.includeUrls != null && !this.options.includeUrls.some(includedUrl => resourcePath.includes(includedUrl))) return;

				// In webpack 5, mutate createData.loaders to affect the final NormalModule.
				if (!resolveData.createData) resolveData.createData = {};
				if (!Array.isArray(resolveData.createData.loaders)) {
					resolveData.createData.loaders = Array.isArray(resolveData.loaders) ? resolveData.loaders : [];
				}

				resolveData.createData.loaders.push({
					loader: path.resolve(__dirname, 'loader.js'),
					options: {
						localeKey,
						localePoPath,
						alwaysRemoveBrackets: this.options.alwaysRemoveBrackets,
						warnOnMissingTranslations: this.options.warnOnMissingTranslations,
						translationLookup: this.translationLookup,
					},
				});
			});
		});
    }
}

module.exports = EasyI18nPlugin;
