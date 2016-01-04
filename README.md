# Combiner
Express Middleware system for Combining CSS and JS files and their dependencies as single files. The combiner library supports the use of extension or otherwise targeted plugins that can perform specific actions on the code before including it in the download.

The combiner has plugins that perform Babel ES2015/6 transpilation, CSS pathing modifications, NPM export modifications so a file can be used within the browser and SASS/SCSS transpilation for CSS files. _Another plugin for LESS also exists but cannot currently be used due to the fact that it is asynchronous and the rest of the code hasn't yet been adapted for that. There is a branch that is close to having these modifications however_.

## Install
To install locally, simply clone this repo or use npm to install

```bash
npm install combiner-lib
```
## Usage
The combiner lib assumes you're using an Express environment for routing and value storage. To integrate with other libraries you'll likely need to fork the project and adjust some values. When instantiating the combiner, a configuration and an instance of the Express app must be passed in. A simple example might be:

```js
var express = require('express');
var app = express();

var Combiner = require('combiner-lib');
var combiner = new Combiner(app, {
  projectRoot: __dirname,
  handlers: {
    '/js/': {
      extensions: ['.js'],
      roots: ['public/javascripts']
    },
    '/css/': {
      extensions: ['.css'],
      roots: ['public/stylesheets']
    }
  }
});
```
The above code monitors the routes /js/ and /css/ and everything beneath them for files that bear some special syntax in their comments. If your directory tree looked like

```
  ┕ public
    ┝ javascripts
    │ ┝ index.js
    │ ┕ common.js
    ┕ stylesheets
      ┝ main.css
      ┕ common.css
```

Then adding the following to the top of index.js would ensure that common.js appeared before it in the combined script.
```js
/** @require ['common.js'] */
```
The syntax supports n-number of items in a comma separated fashion, line breaks and asterisks used in commenting in between "strings" denoting file names. The path to these files are considered to be relative to the handler root, which is in turn relative to the projectRoot; all specified in the config. file.

More complex usages of the Combiner are also supported, with plugins being the most obvious. To automatically transpile your ES6 output, simply change the invocation to the following:

```js
var express = require('express');
var app = express();

var Combiner = require('combiner-lib');
var BabelPlugin = require('combiner-lib/plugins/BabelPlugin')(); // Note that it can take options

var combiner = new Combiner(app, {
  projectRoot: __dirname,
  handlers: {
    '/js/': {
      extensions: ['.js'],
      roots: ['public/javascripts'],
      plugins: [BabelPlugin]
    },
    '/css/': {
      extensions: ['.css'],
      roots: ['public/stylesheets']
    }
  }
});
```

Of course your own hand-written plugins can also be used. Please refer to the existing plugins for examples on usage for now.




