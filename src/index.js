const { SourceMapSource } = require("webpack").sources;
const path = require("path");
const {
    readFileSync,
    writeFileSync,
    mkdirSync
} = require("fs");
const gettextToI18Next = require("i18next-conv").gettextToI18next;

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
    }

    apply(compiler) {
        const mkdir = (dirPath) => {
            try {
                mkdirSync(dirPath);
            } catch (err) {
                if (err.code !== "EEXIST") throw err;
            }
        };

        /**
         * Decode (a small subset of) JavaScript-style escape sequences from *bundle text* into
         * their real runtime characters.
         *
         * Why this exists:
         * - When targeting older environments, Babel/minifiers sometimes emit non-ASCII
         *   characters using unicode escapes, e.g. "don\u2019t" instead of "don’t".
         * - If we then call escapeNuggets(), it will escape backslashes, turning "\u2019" into
         *   "\\u2019".
         * - In the final JS bundle, "\\u2019" is *not* a unicode escape anymore; it becomes a
         *   literal backslash-u sequence and the browser renders "don\u2019t".
         *
         * Example:
         * - Bundle text contains:  "don\u2019t"
         * - Without decode:         escapeNuggets => "don\\u2019t"  (renders as don\u2019t)
         * - With decode first:      unescapeJsLike => "don’t"; then escapeNuggets keeps it as don’t
         *
         * Notes:
         * - This intentionally decodes only "\uXXXX" and "\xXX" sequences.
         * - It avoids decoding when the backslash itself is escaped (e.g. "\\u2019"), because
         *   that usually means the author intended a literal "\u2019" to be displayed.
         */
        const unescapeJsLike = (value) => {
            if (typeof value !== 'string') return value;

            const isHex = (c) => (c >= '0' && c <= '9')
                || (c >= 'a' && c <= 'f')
                || (c >= 'A' && c <= 'F');

            let out = '';
            for (let i = 0; i < value.length; i++) {
                const ch = value[i];
                if (ch !== '\\') {
                    out += ch;
                    continue;
                }

                // If we have an escaped backslash ("\\u...." in text), do not decode.
                if (i > 0 && value[i - 1] === '\\') {
                    out += ch;
                    continue;
                }

                const next = value[i + 1];
                if (next === 'u') {
                    const a = value[i + 2], b = value[i + 3], c = value[i + 4], d = value[i + 5];
                    if (isHex(a) && isHex(b) && isHex(c) && isHex(d)) {
                        out += String.fromCharCode(parseInt(`${a}${b}${c}${d}`, 16));
                        i += 5;
                        continue;
                    }
                } else if (next === 'x') {
                    const a = value[i + 2], b = value[i + 3];
                    if (isHex(a) && isHex(b)) {
                        out += String.fromCharCode(parseInt(`${a}${b}`, 16));
                        i += 3;
                        continue;
                    }
                }

                // Not a recognized escape; keep the backslash.
                out += ch;
            }

            return out;
        };

        compiler.hooks.thisCompilation.tap('EasyI18nPlugin', (compilation) => {
            compilation.hooks.processAssets.tapPromise(
                {
                    name: 'EasyI18nPlugin',
                    stage: compilation.PROCESS_ASSETS_STAGE_DERIVED,
                },
                async () => {
                    const localeKey = this.locale[0];
                    const localePoPath = this.locale[1];

                    if (localePoPath !== null) {
                        var poPath = path.join(this.options.localesPath, localePoPath);

                        mkdir(path.resolve(path.join(this.options.localesPath, "/webpack-easyi18n-temp/")));

                        console.log(`Reading translations from ${poPath}`)
                        var lookupData = await gettextToI18Next(localeKey, readFileSync(poPath), {});
                        var translationLookupPath = path.join(this.options.localesPath, `/webpack-easyi18n-temp/${localeKey}.json`);
                        writeFileSync(translationLookupPath, lookupData);
                        console.log(`${localeKey} translation lookup file created ${translationLookupPath}`);
                    }

                    let translationLookup = null;
                    if (localePoPath !== null) {
                        translationLookup = require(path.join(this.options.localesPath, `/webpack-easyi18n-temp/${localeKey}.json`));
                    }

                    compilation.getAssets().forEach((asset) => {
                        const filename = asset.name;
                        const originalSourceObj = compilation.assets[filename];
                        const originalSource = originalSourceObj.source();

                        // skip any files that have been excluded
                        const modifyFile = typeof originalSource === 'string'
                            && (this.options.excludeUrls == null || !this.options.excludeUrls.some(excludedUrl => filename.includes(excludedUrl)))
                            && (this.options.includeUrls == null || this.options.includeUrls.some(includedUrl => filename.includes(includedUrl)));
                        if (!modifyFile) return;

                        // Unfortunately the regex below doesn't work as js flavoured regex makes only the last capture included
                        // in a capture group available (unlike .NET which lets you iterate over all captures in a group).
                        // This means formatable nuggets with multiple formatable items will fail.
                        //
                        // Take the following nugget for example:
                        // - [[[%0 %1|||1|||2]]]
                        //
                        // The regex below will only include "2" in the second capture group, rather than all captures "1|||2".
                        // We need to do multiple rounds of parsing in order to work around this
                        //const regex = /\[\[\[(.+?)(?:\|\|\|(.+?))*(?:\/\/\/(.+?))?\]\]\]/sg;
                        const regex = /\[\[\[(.+?)(?:\|\|\|.+?)*(?:\/\/\/(.+?))?\]\]\]/sg;

                        let source = originalSource.replace(regex, (originalText, nuggetSyntaxRemoved) => {
                            let replacement = null;

                            if (localePoPath === null) {
                                if (this.options.alwaysRemoveBrackets) {
                                    replacement = nuggetSyntaxRemoved;
                                } else {
                                    return originalText; // leave this nugget alone
                                }
                            } else {
                                // .po files use \n notation for line breaks
                                const translationKey = nuggetSyntaxRemoved.replace(/\r\n/g, '\n');

                                // find this nugget in the locale's array of translations
                                replacement = translationLookup[translationKey];
                                if (typeof (replacement) === "undefined" || replacement === "") {
                                    if (this.options.warnOnMissingTranslations) {
                                        compilation.warnings.push(
                                            new Error(`Missing translation in ${filename}.\n '${nuggetSyntaxRemoved}' : ${localeKey}`));
                                    }

                                    if (this.options.alwaysRemoveBrackets) {
                                        replacement = nuggetSyntaxRemoved;
                                    } else {
                                        return originalText; // leave this nugget alone
                                    }
                                }
                            }

                            // Escape the translated text BEFORE formatting/splicing
                            replacement = EasyI18nPlugin.escapeNuggets(unescapeJsLike(replacement));

                            // format nuggets
                            var formatItemsMatch = originalText.match(/\|\|\|(.+?)(?:\/\/\/.+?)?\]\]\]/s)
                            if (formatItemsMatch) {
                                const formatItems = formatItemsMatch[1]
                                    .split('|||');

                                replacement = replacement.replace(/(%\d+)/g, (value) => {
                                    var identifier = parseInt(value.slice(1));
                                    if (!isNaN(identifier) && formatItems.length > identifier) {
                                        return formatItems[identifier];
                                    } else {
                                        return value;
                                    }
                                });
                            }

                            return replacement;
                        });

                        compilation.updateAsset(filename, new SourceMapSource(
                            source,
                            filename,
                            originalSourceObj.map(),
                            originalSource,
                            null,
                            true));
                    });
                }
            );
        });
    }
}

module.exports = EasyI18nPlugin;
