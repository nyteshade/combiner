/**
 * combiner.js
 *
 * MIT Licensed
 *
 * Copyright (c) 2013-2015 Brielle Harrison
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Example Config Object With Acceptable Parameters
 * {
 *   projectRoot: '/absolute/path/to/project/root/',
 *
 *   networkDefaults: {
 *     protocol: Combiner.(HTTP|HTTPS)
 *     hostname: "defaultHostname",
 *     port: env.PORT
 *   },
 *
 *   handlers: {
 *     '/scripts/': {
 *       extensions: ['.js', '.es6'],
 *       middleware: [BABELPreprocessor],
 *       outputMimeType: 'text/javascript',   // all extensions this type
 *       fileSeparator: '\n;',
 *       fn: JSHandler,
 *       roots: [
 *         'public/js',
 *         {
 *           type: Combiner.NETWORK,
 *           path: '/admin/js'
 *         }
 *       ]
 *     },
 *
 *     '/css/': {
 *       extensions: ['.css', '.less', '.scss', '.sass'],
 *       middleware: [],
 *       plugins: [LESSPlugin, SASSPlugin],
 *       roots: ['less', 'scss', 'public/stylesheets']
 *     },
 *
 *     '/fonts/': {
 *       extensions: ['.woff', '.woff2', '.ttf', '.otf', '.svg', '.eot'],
 *       roots: ['fonts'],
 *       outputMimeTypes: {
 *         '.woff': 'application/font-woff',
 *         '.woff2': 'application/font-woff2',
 *         '.ttf': 'application/font-ttf',
 *         '.otf': 'application/font-otf',
 *         '.svg': 'image/svg+xml',
 *         '.eot': 'application/vnd.ms-fontobject',
 *         '*': 'text/plain'
 *       },
 *       responseHeaders: {
 *         'Expires': 'Thu, 01 Dec 1994 16:00:00 GMT',
 *         'ETag': '737060cd8c284d8af7ad3082f209582d'
 *       }
 *     }
 *   }
 * }
 */

var CachedFile = require('./helpers/CachedFile');
var isA = require('isa-lib')().isA;
var Q = require('q');
var request = require('request');
var csi = require('node-csi');
var fs = require('fs');
var pth = require('path');
var URL = require('url');
var extend = require('extend');
var debug = require('debug')('combiner:combiner');

/**
 * The Combiner is a system that combines, recursively, either CSS or
 * JavaScript files to create a singled packaged output.
 *
 * @param {Express} app the express() object or app variable for your project.
 * @param {Object} config the configuration object that will extend the default
 * properties and modify the way this particular Combiner functions.
 */
function Combiner(app, config) {
  // Ensure an instance is being created
  if (this === global) {
    return new Combiner(app, config);
  }

  if (!app || (app && !app.use && !app.get && !app.set && !app.locals)) {
    throw new Error('The express or app variable is required.');
  }

  // Store the express application variable
  this.app = app;

  // Create a value in app.locals for our CachedFile cache
  this.app.locals.cachedFileCache = {};

  // Update the CachedFile cache
  CachedFile.setCacheGetter(function () { return app.locals.cachedFileCache; });

  // Extend the default configuration with the provided config object if one
  // is present, or the files parameter if it is an object.
  this.config = extend(true, {}, Combiner.DEFAULTS, config || {});

  // Store and resolve the project rootz
  this.projectRoot = pth.resolve(config.projectRoot);

  // Parse and normalize the network defaults
  this.parseNetworkDefaults();

  // Parse and normalize the handlers.
  this.parseHandlers();

  // Apply the handlers
  this.applyHandlers();
}

/**
 * The Combiner "class" instance variables and methods
 * @type {Combiner}
 */
Combiner.prototype = {
  /**
   * This property defines the various handlers and endpoints maintained by
   * this combiner. It also contains the appropriate roots to monitor.
   *
   * @type {Object}
   */
  handlers: null,

  /**
   * Appies the handlers, presumably after a call to parseHandlers()
   * has taken place. The purpose is to register the endpoints on the express
   * app.
   */
  applyHandlers: function() {
    var keys = Object.keys(this.handlers);
    var key;
    var value;
    var i;
    var isValid;
    var endpoint;
    var regexEndpoint;
    var handler;
    var handlerFn;
    var args;
    var fn;

    for (i = 0, key = keys[0]; i < keys.length; i++, key = keys[i]) {
      handler = this.handlers[key];
      endpoint = handler.endpoint;
      handlerFn = isA(Function, handler.fn)
          ? handler.fn.bind(this, handler)
          : this.baseHandlerFn.bind(this, handler);

      debug('Applying %s endpoint', endpoint);
      debug('Using middleware %j', handler.middleware);

      args = [endpoint].concat(handler.middleware).concat(handlerFn);

      this.app.use(endpoint, handler.middleware, handlerFn);
    }
  },

  /**
   * A base handler for Combiner files. It pays no attention to preprocessor
   * files and simply concatenates files as found.
   *
   * @param  {Object} handler the associated handler for this execution
   * @param  {Request} req an Express Request object.
   * @param  {Response} res an Express Response object.
   * @param  {Function} next an optional function to continue the next chain fn
   */
  baseHandlerFn: function __combiner_baseHandler(handler, req, res, next) {
    // Obtain the extension/type for the requested url
    var url = URL.parse(req.url);
    var type = Combiner.getType(url.pathname);

    // Validate whether or not the extension is supported. If not pass to the
    // next endpoint for which this content might apply
    if (handler.extensions.indexOf(type) === -1) {
      return next();
    }

    // Build a value store for this path
    var valueStore = {
      assetName: pth.basename(url.pathname),
      assetPath: pth.dirname(url.pathname),
      assetRelPath: pth.join(pth.dirname(url.pathname)
          .replace(handler.handlerKey, ''),
          pth.basename(url.pathname))
    };

    if (this.app.get('env') !== 'production') {
      valueStore.cachedFiles = {};
    }

    debug('baseHandlerFn:\n\tname: %s\n\tpath: %s\n\trel. path: %s',
        valueStore.assetName, valueStore.assetPath, valueStore.assetRelPath);

    // Collect file and dependencies
    this.getAssetAndDependencies(valueStore.assetRelPath, handler, valueStore);

    // Stream bundle file to the response
    this.writeOutput(
      handler,
      valueStore.order,
      valueStore.cachedFiles,
      req,
      res,
      next,
      valueStore
    );
  },

  /**
   * Load the specified asset, parse it for dependencies, rinse and repeat for
   * each item on the list; finally tacking on the original asset at the end.
   *
   * The whole time, maintaining order of the assets specified to prevent
   * issues with dependent items first. getAssetAndDependencies guarantees to
   * return at least two properties in the shared valueStore.
   *
   *   cachedFiles - a list of all the files and their contents and mtimes
   *   order - an array of keys to cachedFiles showing the order in which these
   *   things should be merged.
   *
   * @param {String} relativePath a path to the asset in question
   * @param {Object} the handler, as specified in the config that applies to
   * this file.
   * @param {Object} valueStore shared scope from the various functions as a
   * value that can be written to over and over in the recusrive context.
   */
  getAssetAndDependencies: function _combiner_getAssetsAndDependencies(
    relativePath,
    handler,
    valueStore
  ) {
    // List of assets to pull based on roots for this handler.
    var existingAssets = [];

    // Ensure we have order :) ...and a cachedFile map as promised
    valueStore.order = valueStore.order || [];
    valueStore.cachedFiles = valueStore.cachedFiles || {};

    // Loop over the relativePath, prepending any supplied prefix or the project
    // root, plus the path specified in the root and finally the relative path.
    // Finally check the file system for the existence of the asset in question
    // and add it to the list if it does.
    var foundOne = false;
    handler.roots.forEach((function(root, index, array) {
      if (root.type === Combiner.NETWORK) {
        return; // move on as we are not supporting this on the first pass
      }

      var prefix = root.prefix || this.projectRoot;
      var fullPath = pth.join(prefix, root.path || '', relativePath);

      debug('checking for %s', fullPath);

      if (fs.existsSync(fullPath)) {
        debug('%s exists!', fullPath);
        existingAssets.push(fullPath);
        foundOne = true;
      }
    }).bind(this));

    // If none of the files were found, report this to the console as an error
    // that can be picked up later.
    if (!foundOne) {
      console.warn(
        '%s%sWARNING%s:The file %s%s%s cannot be found in any of the paths!',
        csi.ON.BOLD,
        csi.FG.YELLOW,
        csi.RESET,
        csi.ON.BOLD,
        relativePath,
        csi.RESET
      );
      handler.roots.forEach((function(root) {
        var prefix = root.prefix || this.projectRoot;
        console.warn('\t%s', pth.join(prefix, root.path || ''));
      }).bind(this));
    }

    // Start processing the files we know about. Recurse back through this
    // function for each of the dependents and just return if there are no
    // files to work with.
    existingAssets.forEach((function _getAsset(assetName, index, array) {
      if (valueStore.cachedFiles[assetName]) {
        debug('Skipping %s as it is already loaded and processed.', assetName);
        debug(valueStore.cachedFiles)
        return;
      }

      var cachedFile = CachedFile.cache[assetName];
      if (cachedFile) {
        debug('Retrieving previously cached file %s', assetName);
        cachedFile.readFile();
      }
      else {
        debug('Fetching and caching %s', assetName);
        debug('Using plugins ', handler.plugins);
        cachedFile = new CachedFile(assetName, true, handler.plugins);
      }

      // Update reference in request valueStore.cachedFile list
      valueStore.cachedFiles[assetName] = cachedFile;

      // Check contents for requirements; defaults to Combiner.REQUIRE
      var requirements = Combiner.parseCommentArray(cachedFile.data);
      for (var i = 0; i < requirements.length; i++) {
        var type = Combiner.getType(requirements[i]);
        var reqHandler = this.getHandlerForType(type) || handler;
        this.getAssetAndDependencies(
          requirements[i],
          reqHandler,
          valueStore
        );
      }

      valueStore.order.push(assetName);
    }).bind(this));

    return valueStore;
  },

  /**
   * Search through the list of handlers registered in the config when the
   * Combiner was created and find the first one that has an extension mapped
   * to the supplied type. Problems can/will occur in cases where a second
   * or other handler with the same type of extension is desired. Exercise
   * caution.
   *
   * @param  {String} type an extension type such as ".js" or ".css"
   * @return {Object} the handler in question or null if none are found.
   */
  getHandlerForType: function _combiner_getHandlerForType(type) {
    for (var handlerKey in this.handlers) {
      var handler = this.handlers[handlerKey];
      if (handler.extensions.indexOf(type) !== -1) {
        return handler;
      }
    }

    return null;
  },

  /**
   * This method examines the supplied handlers and normalizes their
   * structurs for ease of use later. Handler formats are as follows
   *
   *     'endpoint': {
   *       extensions: ['.array','.of','.file','.extensions'],
   *       middleware: [middleware, references, array],
   *       method: 'HTTP method',
   *       roots: [
   *         {
   *           type: Combiner.NETWORK or Combiner.FILE_SYSTEM,
   *           path: '/relative/path/to/files/with/extensions/',
   *           prefix: '/alternative/absolute/path/to/file/directory/',
   *
   *           protocol: ...,    |\
   *           slashes: ...,     | \
   *           auth: ...,        |  \
   *           host: ...,        |   \
   *           port: ...,        |    } Network Default Overrides
   *           hostname: ...,    |   /
   *           hash: ...,        |  /
   *           search: ...,      | /
   *           query: ...        |/
   *         }
   *       ]
   *     }
   */
  parseHandlers: function _combiner_parseHandlers() {
    // Setup the handlers from the config object
    this.handlers = this.config.handlers;

    // Known methods (see http://expressjs.com/api.html#app.METHOD)
    var methods = new RegExp('(' + ([
      'checkout', 'connect', 'copy', 'delete', 'get', 'head', 'lock',
      'merge', 'mkactivity', 'mkcol', 'move', 'm-search', 'notify',
      'options', 'patch', 'post', 'propfind', 'proppatch', 'put',
      'report', 'search', 'subscribe', 'trace', 'unlock', 'unsubscribe'
    ].join('|')) + ')', 'i');

    for (var handlerName in this.handlers) {
      var handler = this.handlers[handlerName];

      // Ensure handlerName which may also be the endpoint, is prefixed with
      // a forward slash character
      if (handlerName.charAt(0) !== '/') {
        this.handlers['/' + handlerName] = handler;
        delete this.handlers[handlerName];
        handlerName = '/' + handlerName;
        handler = this.handlers[handlerName];
      }

      // Check for endpoint property. If the value is a regular expression it
      // will be used, unmodified. If a string, or not present, the possibly
      // modified handlerName will be used in its place.
      if (!handler.endpoint || isA(String, handler.endpoint)) {
        handler.endpoint = handler.handlerKey = handlerName;
      }
      else {
        handler.handlerKey = handlerName;
      }

      // Ensure plugins is at least an empty array
      if (isA(Function, handler.plugins)) {
        handler.plugins = [handler.plugins];
      }
      else if (!isA(Array, handler.plugins)) {
        handler.plugins = [];
      }

      // Drop the handler if there aren't any extensions to look for
      if (isA(Array, handler.extensions) && handler.extensions.length === 0) {
        delete this.handlers[handlerName];
        continue;
      }

      // If no middleware are supplied, create an empty array
      if (!handler.middleware) {
        handler.middleware = [];
      }

      // If we received a single function middleware, wrap it
      if (isA(Function, handler.middleware)) {
        handler.middleware = [handler.middleware];
      }

      // Provide parent key as endpoint

      // Handler methods are presumed to be one of the known values supported
      // by Express.
      if (!handler.method || !methods.test(handler.method)) {
        handler.method = "get";
      }

      // Convert to lowercase now for ease of use later
      handler.method = handler.method.toLowerCase();

      // Process the underlying roots for each handler. If the value is a
      // string, convert it to a proper object with defaults. If the value
      // is of type NETWORK, ensure all the URL properties we might want or
      // need are present.
      for (
        var i = 0, root = handler.roots[0];
        i < handler.roots.length;
        i++, root = handler.roots[i]
      ) {
        if (isA(String, root)) {
          handler.roots[i] = {
            type: Combiner.FILE_SYSTEM,
            path: root
          };
          continue;
        }

        if (root.type === Combiner.FILE_SYSTEM) {
          if (root.prefix) {
            root.prefix = pth.resolve(root.prefix);
          }

          if (!root.path) {
            root.path = '';
          }
        }
        else if (root.type === Combiner.NETWORK) {
          var temp, stringForm;
          extend(true, temp, this.networkDefaults, root, {pathname: root.path});
          stringForm = URL.format(temp);
          extend(true, array[index], URL.parse(stringForm), root);
        }
      }
    }
  },

  /**
   * Assumed to be called using apply/call and being bound to the Combiner
   * instance in question, this function will look through the config for
   * a networkDefaults property. If none are found, the defaults are used.
   */
  parseNetworkDefaults: function _combiner_parseNetworkDefaults() {
    var networkDefaults = extend(
      true,
      Combiner.NETWORK_DEFAULTS,
      this.config.networkDefaults || {}
    );
    var stringForm = URL.format(networkDefaults);
    this.networkDefaults = URL.parse(stringForm);
  },

  /**
   * writeOutput does what you might suspect; it writes the combined output
   * to the disk in middleware mode or to the response when used as the final
   * routing method.
   *
   * @param  {[type]} order       [description]
   * @param  {[type]} cachedFiles [description]
   * @return {[type]}             [description]
   */
  writeOutput: function(
    handler,
    order,
    cachedFiles,
    req,
    res,
    next,
    valueStore
  ) {
    // Build our ordered output string
    var output = order.map(function(assetName, index, array) {
      return cachedFiles[assetName].data;
    }).join(handler.fileSeparator || '');

    // Apply custom outputMimeTypes as defined in the handler.
    if (isA(String, handler.outputMimeType)) {
      res.set('Content-Type', handler.outputMimeType);
    }
    else if (isA(Object, handler.outputMimeTypes)) {
      var types = Object.keys(handler.outputMimeTypes);
      var ext = Combiner.getType(valueStore.assetName);
      if (types.indexOf(ext) !== -1) {
        res.set('Content-Type', handler.outputMimeTypes[ext]);
      }
      else if (types.indexOf('*') !== -1) {
        res.set('Content-Type', handler.outputMimeTypes['*']);
      }
    }

    // Apply any specified response headers; while not advised, it is possible
    // to override Content-Type in this manner.
    if (isA(Object, handler.responseHeaders)) {
      for (var headerName in handler.responseHeaders) {
        if (/Content-Type/i.test(headerName)) {
          debug('%sOverwriting content-type with %s%s',
              csi.FG.RED, handler.responseHeaders[headerName], csi.RESET);
        }
        res.set(headerName, handler.responseHeaders[headerName]);
      }
    }

    res.send(output);
  }
};

/**
 * The Combiner "class" static variables and methods
 * @type {Combiner}
 */
extend(true, Combiner, {
  /** Used when defining handler roots that can be loaded directly */
  FILE_SYSTEM: 'File system path',

  /** Used when defining handler roots that need to be requested */
  NETWORK: 'Network path; uses request',

  /** HTTP non-secure protocol constant for network fetching */
  HTTP: 'http:',

  /** HTTPS secure protocol constant for network fetching */
  HTTPS: 'https:',

  /** Known extension type for JavaScript (JS) files */
  JS: ".js",

  /** Known extension type for Cascading Style Sheets (CSS) files */
  CSS: ".css",

  /** Known extension type for LESS files */
  LESS: ".less",

  /** Known extension type for SCSS files */
  SCSS: ".scss",

  /** Known extension type for SASS files */
  SASS: ".sass",

  /** Default config properties for Combiner instances */
  DEFAULTS: {
    suffix: ".packaged",
  },

  /** Network defaults; supports all properties of node URL objects */
  NETWORK_DEFAULTS: {
    protocol: 'http:',
    hostname: 'localhost',
    port: process.env.PORT || 3000
  },

  /** Regular expression used to parse files for requirements "arrays" */
  REQUIRE: /@require (\[([^\]]+)\])/g,

  /** Regular expression used to parse files for networkOnly "arrays" */
  NET_ONLY: /@networkOnly (\[([^\]]+)\])/g,

  /**
   * A shortcut to produce a Readable stream from a string.
   *
   * @param  {String} string any String of text
   * @return {ReadableStream} see https://nodejs.org/api/stream.html
   */
  getStream: function(string) {
    var Readable = require('stream').Readable;
    var stream = new Readable();
    stream._read = function() {}
    stream.push(string);
    stream.push(null);
    return stream;
  },

  /**
   * Return type of file. This will retrieve the extension as well as make
   * sure that the results are lower cased so as to match the Combiner
   * constants: JS, CSS, LESS, SASS, SCSS.
   *
   * @param  {String} path file path with the file name portion included.
   * @return {String} the file name extension prepared for direct comparison to
   * the named constants.
   */
  getType: function(path) {
    var url = URL.parse(path);
    return pth.extname(url.pathname).toLowerCase();
  },

  /**
   * Given a source file, find the @require text within a comment and
   * the subsequent JSON array value. Once this is found, remove any
   * comment asterisks and/or one one comments injected in the text to
   * make the comment persist over multiple lines.
   *
   * Finally, convert the text back into a JS array for processing and
   * return this value.
   *
   * @param {String} source the source code to process
   * @param {String} regexString defaults to Combiner.REQUIRE
   * @return {Array} an array, empty if there were errors or no require
   *      strings to process
   */
  parseCommentArray: function(source, regexString) {
    var evalString;
    var requiresPortion;
    var regex = new RegExp(regexString || Combiner.REQUIRE);
    var results = [];

    source = source.toString();

    if (!isA(String, source)) {
      debug('%sERROR%s: Cannot parse source\n%s%s%s',
        csi.FG.RED, csi.RESET, csi.ON.BOLD, source, csi.RESET);
      return results;
    }

    if (!(requiresPortion = regex.exec(source))) {
      return results;
    }

    do {
      try {
        requiresPortion = requiresPortion[1];
        evalString = requiresPortion
            .replace(/(\*|\/\/|\r?\n\s*)/g, '')  // Remove *'s and newlines
            .replace(/\,\s*/g,',')          // Remove spaces after commas
        results = results.concat(eval('(' + evalString + ')'));
      }
      catch(e) {
        debug(
          '%sERROR%s: Failed to parse %s',
          csi.FG.RED,
          csi.RESET,
          requiresPortion
        );
      }
    }
    while ((requiresPortion = regex.exec(source)));

    return results;
  }
});

module.exports = Combiner;
