# webpack-easyi18n
### Go from [gettext](https://en.wikipedia.org/wiki/Gettext) catalog (.po files) to embeded localization in your Webpack bundles.

```bash
npm install --save-dev webpack-easyi18n
```
Designed for use with [EasyI18n].

### Usage

To localize text in your application, surround your strings with [[[ and ]]] markup characters to mark them as translatable. We call these snippets 'nuggets':

```js
document.write("[[[Login using]]]");
```

Make your translations (for example using [Poedit](https://poedit.net/)) to create the .po files

Add the easy plugin to your Webpack config (notice the 'Locales' variable that indicates language/.po location):

```js
const Path = require("path");
const Webpack = require("webpack");
const EasyI18nPlugin = require("webpack-easyi18n");

var Locales = {
    "en-gb": null, // Your application default language
    "pt-br": "pt-BR/messages.po"
};

module.exports = Object.keys(Locales).map(function(locale) {

    var plugins = [];

    return {
        entry: Path.join(__dirname, "src", "index"),
        devtool: "source-map",
        output: {
            filename: Locales[locale] === null ? "js/[name].[hash].js" : "js/[name].[hash]." + locale + ".js",
            path: Path.join(__dirname, "dist"),
            publicPath: ""
        },
        plugins: plugins.concat([
            new EasyI18nPlugin([locale, Locales[locale]], {
                srcPath: Path.join(__dirname, "./src"),
                localesPath: Path.join(__dirname, "./Locale")
            })
        ])
    };
});

### React / JSX support

This plugin transforms nuggets at **source level** (via an injected webpack loader), so nuggets can span JSX text, `{expressions}`, and even nested JSX elements.

Example:

```jsx
<p>
  [[[Just {changeStatusBtn} to change your status.]]]
</p>
```

Internally this becomes a translated JSX children sequence rather than a single string, so placeholders like `%0` can be reordered per-locale without breaking React.
```

### Options

|Name|Type|Description|
|:--:|:--:|:----------|
|**`srcPath`**|`{String}`|Directory that should be used to locate your source files with strings for replacement _(required)_|
|**`localesPath`**|`{String}`|Directory containing the po files as referenced by 'Locales'  _(required)_|
|**`alwaysRemoveBrackets`**|`{Boolean}`| If alwaysRemoveBrackets is true and a nugget is missing a translation, then the original string is retained but the brackets are removed _(default:false)_|
|**`warnOnMissingTranslations`**|`{Boolean}`| If warnOnMissingTranslations is true a warning will be displayed on build if a nugget is missing a translation _(default:true)_|
|**`excludeUrls`**|`{String[]}`| If a filepath contains any of the strings contained in this array, it will not be processed _(default:null)_|
|**`includeUrls`**|`{String[]}`| If a filepath does not contains any of the strings contained in this array, it will not be processed _(default:null)_|

A 'webpack-easyi18n-temp' directory beneath you locales directory is created on each Webpack build. There is no need to deploy this directory to production and can be removed, for example using rimraf and the WebpackShellPlugin:

```js
new WebpackShellPlugin({ onBuildStart: ['echo "Webpack Start"'], onBuildEnd: ['rimraf ./locales/webpack-easyi18n-temp'] })
```
