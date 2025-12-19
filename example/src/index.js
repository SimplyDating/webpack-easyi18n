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

// use babel to see how this works across different targets
var onlineFavourites = [{}, {}]
documentWriteLn(`[[[Online favourites (%0)|||${onlineFavourites.length}]]]`);

function documentWriteLn(contentToWrite) {
    document.getElementsByTagName('body')[0].innerHTML += contentToWrite + '<br>';
}