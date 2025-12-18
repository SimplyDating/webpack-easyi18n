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
                                const translationKey = nuggetSyntaxRemoved.replace('\r\n', '\n');

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
