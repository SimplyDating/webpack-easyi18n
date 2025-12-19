documentWriteLn("[[[Login using]]]");
documentWriteLn("[[[Log off]]]");
documentWriteLn("[[[Page not found]]]");
documentWriteLn("[[[Server Error]]]");
documentWriteLn("[[[Forgot Translation]]]");
documentWriteLn("[[[Second Forgot Translation]]]");
documentWriteLn(`[[[Two
lines]]]`);
documentWriteLn("[[[multiple %0|||nuggets]]] [[[on]]] [[[a single line]]]")
documentWriteLn("[[[Hello, %0. My Name is %1.|||John|||Andrew]]]");
documentWriteLn("[[[Hey, 'buddy', how are you?]]]");
documentWriteLn("[[[Hey, \"pal\", how are you?]]]");

// the following tests are only relevant to webpack setups using babel to compile es5-friendly code

// test that concat works - es5 friendly code may add .concat or " + onlineFavourites.length + " instead of template literals
var onlineFavourites = [{}, {}]
documentWriteLn(`[[[Online favourites (%0)|||${onlineFavourites.length}]]]`);

// test fancy quotes - es5 friendly code may convert fancy quotes to unicode characters e.g. \u201C \u201D \u2018 \u2019 which
// were breaking due to us escaping the backslashes
documentWriteLn("[[[“This is in fancy quotes”]]]");
documentWriteLn("[[[‘This is in single fancy quotes’]]]");

function documentWriteLn(contentToWrite) {
    document.getElementsByTagName('body')[0].innerHTML += contentToWrite + '<br>';
}