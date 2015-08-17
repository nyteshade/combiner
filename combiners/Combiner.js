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
 * The Combiner system consists of a JavaScript class to manage the work of
 * reading, combining and writing groups of related files together as a single
 * piece of output.
 *
 * When requiring the combiner.js middleware, it is often a good practice to
 * specify a base configuration that defines how the middleware are to be used
 * with your express server setup.
 *
 * An example from an app.js might be
 * <code>
 *   var Path = require('path');
 *   var app = require('express')();
 *   var ROOT = Path.dirname(__filename);
 *   var combiner = require('combiner')({
 *     root: Path.join(ROOT, 'public'),
 *     jsRoot: Path.join(ROOT, 'public', 'js'),
 *     cssRoot: Path.join(ROOT, 'public', 'css'),
 *     sassRoot: Path.join(ROOT, 'sass'),
 *     sassPrefix: 'removeFromUrl',
 *     scssRoot: Path.join(ROOT, 'scss'),
 *     scssPrefix: 'removeFromUrl',
 *     lessRoot: Path.join(ROOT, 'less'),
 *     express: app
 *   });
 * </code>
 *
 * ROOT is a convenience value that points to the absolute location of the
 * executing directory of the app.js file on the host operating system.
 *
 * root as a config property represents the path to the public directory or
 * whereever files are statically served from in express app server
 *
 * jsRoot as a config property represents the path to the javascript directory
 * within the static file root for the app server
 *
 * cssRoot as a config property represents the path of the css directory within
 * the static file root for the app server
 *
 * express as a config property should be a reference to the express app
 * instance
 *
 * A config object passed into the require for the combiner middleware becomes
 * the default base configuration for all the middleware functions that are
 * exposed; including the JSCombiner, CSSCombiner and the PageNameCombiner.
 * Doing so here prevents the need to do so upon each invocation of these
 * functions.
 *
 * {
 *   projectRoot: '/absolute/path/to/project/root/'
 *
 *   networkDefaults: {
 *     protocol: Combiner.(HTTP|HTTPS)
 *     hostname: "defaultHostname",
 *     port: env.PORT
 *   },
 *
 *   handlers: {
 *     '/scripts/': {
 *       method: 'GET',
 *       extensions: ['.js', '.es6'],
 *       middleware: [BABELPreprocessor],
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
 *       method: 'GET',
 *       extensions: ['.css', '.scss', '.less'],
 *       middleware: [LESSPreprocessor, SASSPreprocessor],
 *       pageName: "inferred from accessed endpoint, but overridable here",
 *       roots: [
 *         'public/css', [basic strings are considered file system paths]
 *         {
 *           type: Combiner.FILE_SYSTEM,
 *           path: 'less',
 *           prefix: '/some/other/file/path/' [if not projectRoot]
 *         },
 *         {
 *           type: Combiner.FILE_SYSTEM,
 *           path: 'sass'
 *         }
 *       ]
 *     }
 *   }
 * }
 */

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
 * A shortcut for require('util').inspect(...).
 *
 * @param  {Object} obj the object to inspect
 * @param  {Number} depth how many levels to inspect, defaults to unlimited
 * @return {String} a string, colorized, and ready to log
 */
function inspect(obj, depth) {
  return require('util').inspect(obj, {
    color: true,
    depth: depth
  });
};

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

  // Extend the default configuration with the provided config object if one
  // is present, or the files parameter if it is an object.
  this.config = extend(true, {}, Combiner.DEFAULTS, config || {});

  // Store and resolve the project rootz
  this.projectRoot = pth.resolve(config.projectRoot);

  // Prepare the requirements and their ordering
  this.requirements = {};
  this.order = [];

  // Obtain the proper cache
  this.cache = Combiner.getGlobalCache();

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

  /** Requirements for the files loaded. */
  requirements: null,

  /** Order of files to reconstruct */
  order: null,

  /** @type {Object} absolute to data about the cached file content */
  cache: null,

  /**
   * Appies the handlers, presumably after a call to parseHandlers()
   * has taken place. The purpose is to register the endpoints on the express
   * app.
   *
   * @return {[type]} [description]
   */
  applyHandlers: function() {

  },

  /**
   * This bit of code loads the files and their dependencies into the
   * cache. If the file already exists in the cache, I need to look into
   * providing a way to refresh it. Maybe do a HEAD call first? Right now
   * the call will be skipped if the file is already cached.
   */
  cacheFile: function(file, rejectOnError, isRequirement, locals) {
    var defer = Q.defer();
    var promise = defer.promise;
    var config = this.config;
    var express = config.express || null;
    var host = express
        && express.locals
        && express.locals.settings
        && express.locals.settings.host
        || 'localhost';
    var port = String(express
        && express.locals
        && express.locals.settings
        && express.locals.settings.port
        || 80);
    var rootUri = Combiner.getRootForType(this.type, config);
    var path = pth.join(pth.resolve(rootUri), file);

    var url = URL.format({
      protocol: 'http:',
      hostname: host,
      pathname: file,
      search: '?skipCombiner=true',
      port: port
    });

    var payload = {
      body: null,
      error: null,
      path: path,
      promise: promise,
      reqs: [],
      reqsPromise: null
    };

    /**
     * The function that executes once the XHR call completes. It should receive
     * the data of the file at the other end as it's parameter.
     *
     * @param  {String} data a string containing the contents of a file
     * @return {Promise} a promise that completes when the process is done.
     */
    var xhrSuccess = (function xhrSuccess(data) {
      debug('%sGOT%s %s', csi.ON.BOLD, csi.OFF.BOLD, file);
      try {
        // Store the file contents in the payload
        payload.body = data;

        // Read the requirements from the comments of the loaded file
        payload.reqs = Combiner.parseCommentArray(data).reverse();

        // If there are any requirements...
        if (payload.reqs.length) {
          // ...add them to the combiner's requirements
          payload.reqs.forEach((function(requirement, index, array) {
            if (!this.requirements[requirement]) {
              this.requirements[requirement] = 0;
            }
            else {
              array.splice(index, 1);
            }
            this.requirements[requirement]++;
          }).bind(this));

          debug(
            '%s%sREQS%s %s%s',
            csi.ON.BOLD,
            csi.HIFG.BLUE,
            csi.OFF.BOLD,
            JSON.stringify(payload.reqs),
            csi.RESET
          );

          payload.reqsPromise = [];
          payload.reqs.forEach((function(req, reqIndex, reqs) {
            var promise = this.cacheFile(req, rejectOnError, true, locals);
            debug('Adding requirement %s\n\t%j', req, Object.keys(this.requirements));
            payload.reqsPromise.push(promise);
          }).bind(this));

          Q.allSettled(payload.reqsPromise).then((function(results) {
            this.cache[file] = payload;
            defer.resolve(payload);
          }).bind(this));
        }
        // Otherwise since there are no requirements, store the body in the
        // payload and move on.
        else {
          this.cache[file] = payload;
          defer.resolve(payload);
        }
      }
      catch(e) {
        debug(
          '%sERROR%s Cannot obtain %s:%j',
          csi.FG.RED,
          csi.RESET,
          file,
          e
        );
        payload.error = e;
        defer.reject(payload);
      }
    }).bind(this);

    if (!isRequirement) {
      this.files.push(file);
    }

    this.order.push(file);

    // If the file we seek isn't cached...
    if (!this.cache[file]) {
      if (
        (this.type == Combiner.SASS ||
        this.type === Combiner.SCSS ||
        this.type === Combiner.LESS) &&
        (locals.CSS && locals.CSS.length && locals.CSS.indexOf(file) != -1)
      ) {
        var processedFile = locals.CSS[0];

        // Should never be more than one;
        if (locals.CSS.length > 1) {
          trace('SOMETHING SMELLS: %j', locals.CSS);
        }

        var typedCache = Combiner.getGlobalCache(processedFile);
        Combiner.getType(file) === Combiner.LESS
          ? lessLog('Caching compiled LESS %s', processedFile)
          : sassLog('Caching compiled SASS/SCSS %s', processedFile);
        xhrSuccess(typedCache[processedFile].body);
      }
      else {
        request.get({
            url: url
          },
          (function(error, response, body) {
            if (error) {
              debug('%sERROR%s %s %j', csi.FG.RED, csi.FG.RESET, file, error);
              payload['error'] = error;
              if (rejectOnError) {
                defer.reject(payload);
              }
              else {
                defer.resolve(payload);
              }
              return;
            }
            xhrSuccess(body);
          }).bind(this)
        );
      }
    }
    // ...otherwise ship the cached version and move on
    else {
      debug(
        '%sCACHED%s %s%s%s',
        csi.ON.BOLD,
        csi.OFF.BOLD,
        csi.HIFG.BLACK,
        file,
        csi.RESET
      );
      xhrSuccess(this.cache[file].body);
    }

    return promise;
  },

  /**
   * Given the fact that we don't want duplicate items in our list and a
   * payload object is not nicely comparable using the === operator, we
   * check for the equality of a sub field. If it exists in the supplied
   * list, we return true. Otherwise we return false.
   *
   * @param {Array} list an array of payload objects to search
   * @param {Object} payload the payload object to search for
   * @return true if the supplied payload already exists in the list; false
   *     otherwise
   */
  hasPayload: function(list, payload) {
    var result = false;
    if (list && payload && payload.path) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].path === payload.path) {
          result = true;
          break;
        }
      }
    }
    return result;
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
  parseHandlers: function() {
    // Start off by copying the supplied config.handlers object
    this.handlers = this.config.handlers || {};

    // Known methods (see http://expressjs.com/api.html#app.METHOD)
    var methods = new RegExp('(' + ([
      'checkout', 'connect', 'copy', 'delete', 'get', 'head', 'lock',
      'merge', 'mkactivity', 'mkcol', 'move', 'm-search', 'notify',
      'options', 'patch', 'post', 'propfind', 'proppatch', 'put',
      'report', 'search', 'subscribe', 'trace', 'unlock', 'unsubscribe'
    ].join('|')) + ')', 'i');

    this.handlers.forEach((function(handler, index, array) {
      // Drop the handler if there aren't any extensions to look for
      if (isA(handler.extensions, Array) && handler.extensions.length === 0) {
        array.splice(index, 1);
        return;
      }

      // If no middleware are supplied, create an empty array
      if (!handler.middleware) {
        handler.middleware = [];
      }

      // If we received a single function middleware, wrap it
      if (isA(handler.middleware, Function)) {
        handler.middleware = [handler.middleware];
      }

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
      handler.roots.forEach((function(root, rootIndex, rootArray) {
        if (isA(root, String)) {
          rootArray[rootIndex] = {
            type: Combiner.FILE_SYSTEM,
            path: root
          };
          return;
        }

        if (root.type === Combiner.FILE_SYSTEM) {
          if (root.prefix) {
            root.prefix = pth.resolve(root.prefix);
          }
        }

        if (root.type === Combiner.NETWORK) {
          var temp, stringForm;
          extend(true, temp, this.networkDefaults, root, {pathname: root.path});
          stringForm = URL.format(temp);
          extend(true, rootArray[rootIndex], URL.parse(stringForm), root);
        }
      }).bind(this));
    }).bind(this));
  },

  /**
   * Assumed to be called using apply/call and being bound to the Combiner
   * instance in question, this function will look through the config for
   * a networkDefaults property. If none are found, the defaults are used.
   */
  parseNetworkDefaults: function() {
    var networkDefaults = extend(
      true,
      Combiner.NETWORK_DEFAULTS,
      this.config.networkDefaults || {}
    );
    var stringForm = URL.format(networkDefaults);
    this.networkDefaults = URL.parse(stringForm);
  },

  /**
   * A payload is a chunk of data stored about a particular file or
   * resource. These are created in the {@link #cacheFile} method. This
   * method builds up a flattened list of payload objects for each top
   * level payload supplied.
   *
   * @param {Object} payload this is a file descriptor created in cacheFile
   * @param {Array} list this is a list that is passed in and returned to
   *     allow for appending of a single list
   * @return the list supplied or the one created when no list is supplied
   */
  processPayload: function(payload, list) {
    if (!list) list = [];
    if (payload.reqsPromise && payload.reqsPromise.length) {
      for (var i = 0; i < payload.reqsPromise.length; i++) {
        var subPayload = payload.reqsPromise[i].valueOf();
        this.processPayload(subPayload, list);
        if (!this.hasPayload(list, subPayload)) {
          list.push(subPayload);
        }
      }
    }
    if (!this.hasPayload(list, subPayload)) {
      list.push(payload);
    }
    return list;
  },

  /**
   * This method takes a list of files relative to the appropriate root
   * of this Combiner. These files are then loaded, searched for noted
   * requirements. If there are any, those files will also be given the
   * same procedure.
   *
   * This code maintains the ordering of the scripts as necessary, placing
   * any listed requirements before the content of the supplied file, in
   * their specified order.
   *
   * Finally when all is said and done, the {@code output} property is
   * filled with the content of the loaded data.
   *
   * @param {Array(String)} filesToRead an array of Strings denoting the
   *     name and relative path of the files to parse.
   * @return a promise that can be listened to for when the process is
   *     complete. It receives all the payloads in its resolution.
   */
  readFiles: function(filesToRead, locals) {
    debug('[readFiles()] %j %j', filesToRead, locals);

    var config    = this.config;
    var files     = filesToRead || this.files;
    var promises  = [];
    var defer     = Q.defer();
    var promise   = defer.promise;
    var rootUri   = Combiner.getRootForType(this.type, this.config);

    // Code is suspect; review for refactor
    this.ROOTS.forEach((function(root, rootIndex) {
      files.forEach((function(file, fileIndex) {
        debug('Caching %s', file);
        promises.push(this.cacheFile(file, undefined, undefined, locals));
      }).bind(this));
    }).bind(this));

    Q.allSettled(promises).then((function(promised) {
      var fullPath;

      debug(
        '%sDONE%s All files (%j) accounted for%s',
        csi.FG.GREEN,
        csi.FG.RESET,
        files,
        csi.RESET
      );

      try {
        debug('[readFiles()] Processing payloads');
        var result = [];
        for (var i = 0; i < promised.length; i++) {
          result = this.processPayload(promised[i], result);
          debug('Payload %d processed: %j', i, result[result.length - 1]);
        }

        this.order.reverse();
        this.output = "";
        this.order.forEach((function(item) {
          fullPath = pth.join(rootUri, item);
          trace('Adding %s contents %j', fullPath, !!this.cache[fullPath]);
          if (!this.cache[fullPath]) {
            debug('%s%s%s missing!!', csi.FG.RED, fullPath, csi.RESET);
          }
          else {
            this.output += this.cache[fullPath].body;
          }
        }).bind(this));

        defer.resolve(result);
      }
      catch (e) {
        debug(
          '%sERROR%s: Failed in readFiles(%s) Q.all(): %s',
          csi.FG.RED,
          csi.RESET,
          fullPath || '',
          JSON.stringify(e, null, "  ")
        );

        defer.reject(e);
      }
    }).bind(this));

    return promise;
  },

  /**
   * Writes the combined output to a file.
   *
   * @param output the combined files as a string to write to a file.
   * @param dest the destination path or one will be calculated.
   * @return {Promise} a promise that is resolved once the file writing is
   * complete
   */
  writeOutput: function(output, dest) {
    var outputObtained = Q.defer();
    var result = Q.defer();

    output = output || this.output;

    if (output.length === 0) {
      this.readFiles().then(function() {
        output = this.output;
        outputObtained.resolve(this.output);
      });
    }
    else {
      outputObtained.resolve(output);
    }

    outputObtained.promise.then(function(output) {
      var fpath;
      var dir =
          Combiner.getRootForType(this.type, this.config) || process.cwd();

      fpath = pth.resolve(
        pth.join(dest || this.config.outputPath || dir, this.config.output)
      );

      fs.writeFile(fpath, output, function(err) {
        if (err) {
          result.reject(err);
        }
        else {
          result.resolve({
            file: fpath,
            uri: fpath.replace(root, '')
          });
        }
      });
    });

    return result.promise;
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
  REQUIRE: /(?:\/\/|\/\*|\s*\*\s*)*\**\s*@require\s*(\[([^\]]+)\])/g,

  /** Regular expression used to parse files for networkOnly "arrays" */
  NET_ONLY: /(?:\/\/|\/\*|\s*\*\s*)*\**\s*@networkOnly\s*(\[([^\]]+)\])/g,

  /**
   * Returns the proper root for a file based on the extension of the requested
   * asset.
   *
   * @param  {String} type a Combiner known type (i.e. .js, .css, .sass, etc...)
   * @return {String} the path root for this type.
   */
  getRootForType: function(type, config) {
    var result = null;

    if (type === Combiner.JS) {
      result = config.jsRoot;
    }
    else if (type === Combiner.LESS && config.lessRoot) {
      result = config.lessRoot;
    }
    else if (type === Combiner.SASS && config.sassRoot) {
      result = config.sassRoot;
    }
    else if (type === Combiner.SCSS && config.scssRoot) {
      result = config.scssRoot;
    }
    else if (type === Combiner.CSS
        || type === Combiner.LESS
        || type === Combiner.SCSS
        || type === Combiner.SASS) {
      result = config.cssRoot;
    }

    return result;
  },

  /**
   * Retrieve the URI for a given type. This code removes the project root from
   * the root url for a given type, which should, usually, provide a propper
   * relative uri for a given type.
   *
   * @param  {String} type extension type; i.e. '.js' or '.css'
   * @param  {Object} config Combiner configuration object
   * @return {String} a relative uri for the given type
   */
  getUriForType: function(type, config) {
    return Combiner.getRootForType(type, config)
        .replace(config.root, '');
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
    return pth.extname(path).toLowerCase();
  },

  /**
   * Obtain the location of where files are being cached in the global
   * space.
   *
   * @param {String} type the type of global cache that is desired
   * @return {Object} a map of the uri->content mapping for the indicated type
   */
  getGlobalCache: function(type) {
    // Convert supplied file name to extension if necessary.
    var indexOfPeriod = type.indexOf('.');
    if (indexOfPeriod !== 0 && indexOfPeriod > -1) {
      type = Combiner.getType(type);
    }

    // This simply ensures that both the CombinerCache and the type map exist
    ((global.CombinerCache = global.CombinerCache || {})[type] =
        global.CombinerCache[type] || {});

    // Return the appropriate cache
    return global.CombinerCache[type];
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

    if (Object.prototype.toString.call(source) !== '[object String]') {
      debug('%sERROR%s: Cannot parse source %s', csi.FG.RED, csi.RESET, source);
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