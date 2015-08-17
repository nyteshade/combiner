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
var trace = require('debug')('combiner:trace');
var cssLog = require('debug')('combiner:css');
var jsLog = require('debug')('combiner:js');

var moduleState = {};
var root = '';
var jsRoot = '';
var cssRoot = '';

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
 * @param files an array of files to combine or a config object with a files
 *     property
 * @param config a configuration that would override any of the default values
 *     supplied when the combiner is required by a script or above and beyond
 *     the Combiner.DEFAULTS values
 */
function Combiner(files, config) {
  // Ensure an instance is being created
  if (this === global) {
    return new Combiner(files, config);
  }

  // Extend the default configuration with the provided config object if one
  // is present, or the files parameter if it is an object.
  config = extend({}, Combiner.DEFAULTS, {
      root: moduleState.root,
      jsRoot: moduleState.jsRoot,
      jsUri: moduleState.jsRootUri,
      cssRoot: moduleState.cssRoot,
      cssUri: moduleState.cssRootUri,
      express: moduleState.express || null
  }, isA(Object, files) ? files : config || {});

  // Determine if the first parameter is actually an object with a files
  // parameter. If file parameter is an array, use that value. Others make
  // an empty files array. (TODO: Should this be [config.files] if config.files
  // is a String?)
  if (isA(Object, files) && files.files) {
    files = isA(Array, config.files) && config.files || [];
  }

  // If a type isn't specified, derive it from one of the files if we have a
  // list.
  if (!config.type && files && files.length) {
    config.type = Combiner.getType(files[0]);
  }

  // remove query string if present.
  config.output = config.output.replace(/\?.*/, "");

  // Generate the output file name. We remove the extension from the supplied
  // output (supplied where?). We add the suffix if one exists and then again
  // append the type or .js if one isn't specified.
  config.output = config.output.replace(Combiner.getType(config.output), '')
      + config.suffix + (config.type || Combiner.JS);

  this.ROOTS = isA(Array, config.roots) && config.roots || [];
  this.type = config.type || Combiner.JS;
  this.files = isA(Array, files) && files || [];
  this.requirements = {};
  this.order = [];
  this.cache = Combiner.getGlobalCache(this.type);
  this.config = config;
  this.output = "";

  if (!this.ROOTS.length) {
    this.ROOTS.push(this.type === Combiner.JS ? config.jsRoot : cssRoot);
  }
}

/**
 * The Combiner "class" instance variables and methods
 * @type {Combiner}
 */
Combiner.prototype = {
  /**
   * JavaScript root directory. All JavaScript should be in one
   * of the directories this array contains.
   */
  ROOTS: null,

  /** The extension of file to process for this combiner action (w/dot) */
  type: null,

  /** Known files required to include (in order) */
  files: null,

  /** Requirements for the files loaded. */
  requirements: null,

  /** Order of files to reconstruct */
  order: null,

  /** Already read */
  cache: null,

  /** Flag denoting whether or not a readFiles() call is executing */
  isReading: false,

  /** Reading state; some variables to access state between nested calls */
  readState: null,

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
extend(Combiner, {
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
    output: "concatted"
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

function SASSPreprocessor(config) {
  sassLog('Registering SASSPreprocessor');

  return function _SASSPreprocessor(req, res, next) {
    sassLog('[SASSPreprocessor] Processing sass/scss files');

    if (!config.scssRoot && !config.sassRoot) {
      return next();
    }

    var sass = require('node-sass');
    var exts = ['.sass', '.scss'];
    var ext = Combiner.getType(req.url);

    if (exts.indexOf(ext) === -1) {
      sassLog('Skipping %s', req.url);
      return next();
    }

    var root, prefix, file, filePath, exists;

    root = Combiner.getRootForType(ext, config);
    prefix = ext.toLowerCase() === '.scss'
        ? config.scssPrefix || config.prefix || ''
        : config.sassPrefix || config.prefix || '';
    file = req.url.replace(prefix, '');
    filePath = pth.join(root, file);

    sassLog('[URL] %s', req.url);
    sassLog('[Root] %s', root);
    sassLog('[Prefix] %s', prefix);
    sassLog('[File] %s', file);
    sassLog('[FilePath] %s', filePath);

    fs.exists(filePath, function(fileExists) {
      sassLog('%j', fileExists);
      if (!fileExists) {
        sassLog('%s cannot be found', filePath);
        return next();
      }

      sass.render({ file: filePath }, function(err, results) {
        if (err) {
          sassLog('%s', JSON.stringify(err, null, "  "));
        }
        else {
          var SASSCache = Combiner.getGlobalCache(file);
          SASSCache[file] = {
            body: results.css.toString(),
            root: root,
            path: filePath,
            prefix: prefix,
            file: file
          };

          res.locals.CSS = res.locals.CSS || [];
          res.locals.CSS.push(file);
        }

        return next();
      });
    })
  }
}

function LESSPreprocessor(config) {
  lessLog('Registering LESSPreprocessor');

  return function _lessPreprocessor(req, res, next) {
    lessLog('[LESSPreprocessor] Processing less files');

    if (!config.lessRoot) {
      lessLog('[LESSPreprocessor] No lessRoot defined. Bailing');
      return next();
    }

    var less = require('less');
    var exts = ['.less'];
    var ext = Combiner.getType(req.url);

    if (exts.indexOf(ext) === -1) {
      lessLog('Skipping %s as %j is not in %j', req.url, ext, exts);
      return next();
    }

    var root, prefix, file, filePath, exists;

    root = config.lessRoot;
    prefix = config.lessPrefix || config.prefix || '';
    file = req.url.replace(prefix, '');
    filePath = pth.join(root, file);

    lessLog('[URL] %s', req.url);
    lessLog('[Root] %s', root);
    lessLog('[Prefix] %s', prefix);
    lessLog('[File] %s', file);
    lessLog('[FilePath] %s', filePath);

    fs.exists(filePath, function(fileExists) {
      lessLog('%j', fileExists);
      if (!fileExists) {
        lessLog('%s cannot be found', filePath);
        return next();
      }

      fs.readFile(filePath, function(err, contents) {
        if (err) {
          lessLog('%s', JSON.stringify(err, null, "  "));
          return next();
        }

        less.render(
          contents.toString(),
          {
            sourceMap: {sourceMapFileInline: true}
          }
        ).then(function(output) {
          var LESSCache = Combiner.getGlobalCache(file);
          LESSCache[file] = {
            body: output.css,
            root: root,
            path: filePath,
            prefix: prefix,
            file: file
          };

          res.locals.CSS = res.locals.CSS || [];
          res.locals.CSS.push(file);

          trace('res.locals.CSS %j', res.locals.CSS);

          return next();
        });
      });
    });
  }
}

/**
 * The page name combiner is a piece of middleware that automatically combines
 * any JS and CSS into two separate packages. The names of the generated files
 * are automatically determined by the route name. This can be overridden by
 * specifying an object context with a specified url property. The middleware
 * generator NamedCombiner(name) will do this automatically.
 *
 * @param req the request object as supplied by Node.js
 * @param res the response object as supplied by Node.js
 * @param next the next middleware in the chain
 */
function PageNameCombiner(req, res, next) {
  var defExtension, pageExtension, pageName, uriToPage, url,
      jsPageName, jsPagePath, jsCombiner, jsTask,
      cssPageName, cssPagePath, cssCombiner, cssTask, mkdirp;

  mkdirp = require('mkdirp');
  url = this.url || req.url;
  defExtension = '.' + req.app.get('view engine');
  pageExtension = Combiner.getType(url) || defExtension;
  pageName = url === '/' ? 'index'
      : pth.basename(url).replace(pageExtension, '');

  // remove query string if present.
  pageName = pageName.replace(/\?.*/, "");

  uriToPage = pth.dirname(url);

  jsPageName = pageName;
  jsPagePath = pth.join(jsRoot, uriToPage, 'pages');
  mkdirp.sync(jsPagePath);
  jsCombiner = req.app.jsCombiner || new Combiner(extend({},
    JSCombiner.baseConfig,
    {
      type: Combiner.JS,
      output: jsPageName,
      outputPath: jsPagePath
    }
  ));

  jsTask = jsCombiner.readFiles(
    [pth.join('pages', jsPageName + Combiner.JS)],
    res.locals
  );

  cssPageName = pageName;
  cssPagePath = pth.join(cssRoot, uriToPage, 'pages');
  mkdirp.sync(cssPagePath);
  cssCombiner = req.app.cssCombiner || new Combiner(extend({},
    CSSCombiner.baseConfig,
    {
      type: Combiner.CSS,
      output: cssPageName,
      outputPath: cssPagePath
    }
  ));

  cssTask = cssCombiner.readFiles(
    [pth.join('pages', cssPageName + Combiner.CSS)],
    res.locals
  );

  Q.all([jsTask, cssTask]).done(function() {
    Q.all([
      jsCombiner.writeOutput(),
      cssCombiner.writeOutput()
    ]).then(function(combined) {
      res.locals.pageJS = combined[0].uri;
      res.locals.pageCSS = combined[1].uri;
      next();
    });
  });
};

/**
 * A utility function that returns a PageNameCombiner middleware function that
 * has a named url bound to the name that is supplied as the paramter to this
 * function.
 *
 * This is really useful for routes that have parameterized values or that do
 * not neatly resolve to a file name.
 *
 * @param name the url to bind the returned PageNameCombiner middleware with
 */
function NamedCombiner(name) {
  return PageNameCombiner.bind({
    url: name
  });
}

/**
 * A JavaScript middleware that wraps a Combiner instance. This is used by the
 * PageNameCombiner but can be used individually as well. Subsequent requests
 * that should skip this middleware for any particular reason can specify the
 * URL parameter "[?&]skipCombiner=true".
 *
 * @param req the request object as supplied by Node.js
 * @param res the response object as supplied by Node.js
 * @param next the next middleware in the chain
 */
function JSCombiner(req, res, next) {
  var skipCombiner = req.query.skipCombiner;
  if (skipCombiner && skipCombiner.toLowerCase() === "true") {
    return next();
  }

  var config = JSCombiner.baseConfig || {},
      jsPageName = req.params[0],
      jsCombiner = req.app.jsCombiner || new Combiner(config);

  if (pth.basename(req.url).indexOf(jsCombiner.config.suffix) === -1) {
    jsCombiner.readFiles([jsPageName], res.locals).then(function() {
      res.set('Content-Type', 'text/javascript');
      res.send(jsCombiner.output);
    });
  }
  else {
    return next();
  }
};

/**
 * A CSS middleware that wraps a Combiner instance. This is used by the
 * PageNameCombiner but can be used individually as well. Subsequent requests
 * that should skip this middleware for any particular reason can specify the
 * URL parameter "[?&]skipCombiner=true".
 *
 * @param req the request object as supplied by Node.js
 * @param res the response object as supplied by Node.js
 * @param next the next middleware in the chain
 */
function CSSCombiner(req, res, next) {
  var skipCombiner = req.query.skipCombiner;
  if (skipCombiner && skipCombiner.toLowerCase() === "true") {
    return next();
  }

  var types = [Combiner.SASS, Combiner.SCSS, Combiner.LESS, Combiner.CSS];
  var type = Combiner.getType(req.url);
  var config = extend({}, CSSCombiner.baseConfig || {}, {type: type});
  var cssPageNames = res.locals.CSS
      ? res.locals.CSS
      : [req.params[0]];
  var cssCombiner = req.app.cssCombiner || new Combiner(config);

  cssLog('[PageNames] %s', cssPageNames);
  cssLog('[Params] %j', req.params);

  if (types.indexOf(type) !== -1) {
    cssLog('[Reading Files] %s', cssPageNames);
    cssCombiner.readFiles(cssPageNames, res.locals).then(function() {
      res.set('Content-Type', 'text/css');
      res.send(cssCombiner.output);
    });
  }
  else {
    return next();
  }
};

/**
 * This function sets up a route, which by default is anything under
 * /js/, that recursively will build up a combined package based on the
 * various @require [] values in comments at the top of each file.
 *
 * If pathName is supplied as a string, the resulting regular expression
 * would appear to be an escaped version of "/pathName/(.*)" If this isn't
 * sufficient, passing in your own regular expression with the first
 * capture group representing the file can be supplied.
 *
 * @param {Express} express an instance of the express app server
 * @param {Function|Array} additionalMiddleware a function or an array of
 * functions of extra middleware to invoke on each call to the created route
 * @param {String|RegExp} pathName a string or regular expression (see above)
 */
function handleJS(express, additionalMiddleware, pathName) {
  var middleware;
  var regex = isA(RegExp, pathName)
      ? pathName
      : new RegExp("^\\/" + (pathName || "js") + "\\/(.*)$");

  if (additionalMiddleware) {
    middleware = [];

    if (isA(Function, additionalMiddleware)) {
      middleware.push(middleware);
    }
    else if (isA(Array, additionalMiddleware)) {
      middleware = additionalMiddleware;
    }

    express.get.apply(express, [regex].concat([middleware, JSCombiner]));
  }
  else {
    express.get(regex, JSCombiner);
  }
}

/**
 * This function sets up a route, which by default is anything under
 * /css/, that recursively will build up a combined package based on the
 * various @require [] values in comments at the top of each file.
 *
 * If pathName is supplied as a string, the resulting regular expression
 * would appear to be an escaped version of "/pathName/(.*)" If this isn't
 * sufficient, passing in your own regular expression with the first
 * capture group representing the file can be supplied.
 *
 * @param {Express} express an instance of the express app server
 * @param {Function|Array} additionalMiddleware a function or an array of
 * functions of extra middleware to invoke on each call to the created route
 * @param {String|RegExp} pathName a string or regular expression (see above)
 */
function handleCSS(express, additionalMiddleware, pathName) {
  debug('Registering CSS combiner');

  var regex = isA(RegExp, pathName)
      ? pathName
      : new RegExp("^\\/" + (pathName || "css") + "\\/(.*)$");

  if (additionalMiddleware) {
    var middleware = [];

    if (isA(Function, additionalMiddleware)) {
      middleware.push(additionalMiddleware);
    }
    else if (isA(Array, additionalMiddleware)) {
      middleware = additionalMiddleware;
    }

    express.get.apply(express, [regex].concat([middleware, CSSCombiner]));
  }
  else {
    express.get(regex, CSSCombiner);
  }
}

/**
 * This function sets up two routes, which by default are anything under
 * /js/ and /css/, that recursively will build up combined packages based
 * on the various @require [] values in comments at the top of each file.
 *
 * If jsPath or cssPath is supplied as a string, the resulting regular
 * expression would appear to be an escaped version of "/pathName/(.*)"
 * If this isn't sufficient, passing in your own regular expression with
 * the first capture group representing the file can be supplied.
 *
 * @param {Express} express an instance of the express app server
 * @param {Function|Array} additionalMiddleware a function or an array of
 * functions of extra middleware to invoke on each call to the created route
 * @param {String|RegExp} jsPath a string or regular expression (see above)
 * @param {String|RegExp} cssPath a string or regular expression (see above)
 * @param jsPath an alternate value to use instead of 'js' when setting
 *     up the route
 * @param cssPath an alternate value to use instead of 'css' when setting
 *     up the route
 */
function handleScriptAndStyle(express, additionalMiddleware, jsPath, cssPath) {
  debug('Registering JavaScript Combiner');
  handleJS(express, additionalMiddleware, jsPath);
  debug('Registering CSS Combiner');
  handleCSS(express, additionalMiddleware, cssPath);
}

/**
 * This function takes a config object that defines the base config for the
 * JSCombiner and CSSCombiner middleware. However when requiring the combiner
 * middleware calling this function is necessary for everything else to work
 * as intended. An example is as follows:
 * <code>
 *   var Path = require('path'),
 *       app = require('express')(),
 *       ROOT = Path.dirname(__filename),
 *       combiner = require('./middleware/combiner.js')({
 *         root: Path.join(ROOT, 'public'),
 *         jsRoot: Path.join(ROOT, 'public', 'js'),
 *         cssRoot: Path.join(ROOT, 'public', 'css'),
 *         express: app
 *       });
 * </code>
 */
module.exports = function(config) {
  CSSCombiner.baseConfig = config;
  JSCombiner.baseConfig = config;

  // Middleware
  this.SASSPreprocessor = SASSPreprocessor;
  this.LESSPreprocessor = LESSPreprocessor;
  this.CSSCombiner = CSSCombiner;
  this.JSCombiner = JSCombiner;
  this.PageNameCombiner = PageNameCombiner;
  this.NamedCombiner = NamedCombiner;
  this.Combiner = Combiner;

  // Register functions
  this.handleCSS = handleCSS;
  this.handleJS = handleJS;
  this.handleScriptAndStyle = handleScriptAndStyle;

  this.root = root = config.root || process.cwd();
  this.jsRoot = jsRoot = config.jsRoot || pth.join(this.root, 'js');
  this.jsRootUri = this.jsRoot.replace(this.root, '');
  this.cssRoot = cssRoot = config.cssRoot || pth.join(this.root, 'css');
  this.cssRootUri = this.cssRoot.replace(this.root, '');

  this.express = config.express || null;
  extend(moduleState, this);

  return this;
}
