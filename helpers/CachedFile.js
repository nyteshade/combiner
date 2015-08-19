/**
 * helpers/CachedFile.js
 *
 * The CachedFile class loads the contents of a file from the file system if
 * it hasn't already been cached and/or if the file has a newer modified
 * timestamp as compared to the cached version.
 *
 * Subsequent instances share the same cache thereby optimizing the loading of
 * the files in question.
 *
 * The MIT License (MIT)
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
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

var fs = require('fs');
var path = require('path');
var Q = require('q');
var csi = require('node-csi');
var indent = require('indent-string');
var debug = require('debug')('combiner:cachedfile');

/**
 * The simple but elegant cache backing for CachedFile. This object is
 * responsible for storing the cached files on the file system. It may not
 * however, survive multiple reqiure calls.
 *
 * @type {Object}
 */
var cachedFileCache = {};

/**
 * A function that retrieves the cache to be used for CachedFile. By default
 * it returns the local instance of cache. In many cases this will be more than
 * sufficient for a users needs. If however, the cache should be shared or
 * located elsewhere, calling CachedFile.setCacheGetter will overwrite the
 * module's _getCache function with one of the users choosing.
 *
 * It is worth noting that failure to provide a working function that returns
 * an object capable of being used as a cache may cause unexpected and difficult
 * to solve bugs throughout the application. Overwrite this function with care
 *
 * @return {Object} the cache object used by CacehdFile
 */
var _originalGetCache;
var _getCache = _originalGetCache = function __defaultCacheGetter() {
  return cachedFileCache;
}

/**
 * By default the file root is the same as that of the current working
 * directory. This can be overridden by specifying the optionalRoot value.
 *
 * @param  {String} filePath path to file, relative to the application
 */
function CachedFile(filePath, synchronous, plugins) {
  this.deferreds = {};
  this.path = filePath;
  this.plugins = plugins || [];
  this.synchronous = synchronous;

  CachedFile.cache[this.path] = this;

  this.data = null;
  this.mtime = Number.MAX_VALUE;

  this.readFile(synchronous);
}

CachedFile.prototype = Object.create({}, {
  /**
   * Invokes the reading of the file from the filesystem and the subsequent
   * caching of the file and its modified time stamp. If sync is supplied, this
   * is done in synchronous fashion with the return value being the contents
   * of the file itself.
   *
   * @param  {Boolean} sync if true, the operation is synchronous
   * @return {String|Promise} the data of the file if sync is true, or a promise
   * that will resolve when it is finished otherwise.
   */
  readFile: {
    value: function _readFile(synchronous) {
      var startTime = Date.now();
      var self = this;
      var cache = CachedFile.cache;

      // Use the saved synchronized state if none is supplied
      synchronous = synchronous || this.synchronous;

      this.deferreds.file = Q.defer();
      this.deferreds.stat = Q.defer();

      if (!!synchronous) {
        var mtime = new Date(fs.statSync(self.path).mtime).getTime();
        var useCache = cache[self.path] && cache[self.path].mtime <= mtime;

        self.data = useCache
          ? cache[self.path].data
          : fs.readFileSync(self.path).toString();
        self.mtime = useCache ? self.mtime : mtime;

        self.deferreds.stat.resolve(self.mtime);
        self.deferreds.file.resolve(self.data);

        debug('readFile(%s) %dms [sync] %s', self.path,
            Date.now() - startTime, useCache ? '[cached]' : '');

        if (!useCache) {
          self.data = self.runPlugins(self.data, !!synchronous);
        }

        return self.data;
      }

      fs.stat(this.path, function(statErr, stat) {
        if (statErr) { self.deferreds.stat.reject(statErr); }

        var mtime = statErr
          ? Number.MAX_VALUE
          : new Date(stat.mtime).getTime();
        var useCache = cache[self.path] && cache[self.path].mtime <= mtime;
        var cache = CachedFile.cache;

        if (!useCache) {
          fs.readFile(self.path, function(readErr, file) {
            if (readErr) { self.deferreds.file.reject(readErr); }

            // Only run the plugins on non-cached data
            self.data = self.runPlugins(file.toString(), !!synchronous);
            self.mtime = mtime;

            self.deferreds.file.resolve(self.data);
            self.deferreds.stat.resolve(self.mtime);

            debug('readFile(%s) %dms', self.path,
                Date.now() - startTime);

            if (readErr) {
              debug('\x1b[31mError\x1b[0m %j', readErr);
            }
          });
        }
        else {
          self.deferreds.file.resolve(cache[self.path].data);
          self.deferreds.stat.resolve(cache[self.path].mtime);
          debug('readFile(%s) %dms [cached]', self.path,
              Date.now() - startTime);
        }
      });

      return this.deferreds.file.promise;
    },
    enumerable: true,
    configurable: true,
    writable: true
  },

  /**
   * A getter that returns an array of promises used to track state in this
   * class. NOTE: referenced as .promises and not called as .promises()
   *
   * @type {Array} an array of promise objects.
   */
  promises: {
    enumerable: true,
    configurable: false,
    get: function _promises() {
      return Object.keys(this.deferreds).map((function(key) {
        return this.deferreds[key].promise;
      }).bind(this));
    }
  },

  /**
   * A getter that returns a single promise coalescing all the other promises
   * used to keep state in this class instance.
   * NOTE: referenced as .ready and not called as .ready()
   *
   * @type {Promise} a promise that resolves when all inner promises have
   */
  ready: {
    enumerable: true,
    configurable: false,
    get: function _ready() {
      return Promise.all(this.promises);
    }
  },

  /**
   * The CachedFile can optionally take n-number of plugins that will run on
   * the content before it is cached. Each plugin takes a pass. They are
   * expected to return the modified (or same value if no modifications have
   * occurred) data.
   *
   * Each plugin should have the signature of (data, synchronous, extension)
   * where:
   *   data - a string containing the data in its current state
   *   synchronous - true if the CachedFile was created with sync specified
   *   extension - the lowercase file extension of the cached file
   *
   * @param {String} data the loaded file data
   * @param {Boolean} synchronous true if the directive is to load the file
   * without waiting; false if promises are being used to signal when the file
   * is done loading.
   */
  runPlugins: {
    value: function __cachedfile_runPlugins(data, synchronous) {
      var alteredData = data;
      var extension = path.extname(this.path).toLowerCase();

      for(var i = 0; i < this.plugins.length; i++) {
        try {
          alteredData = this.plugins[i].call(
            this,
            alteredData,
            synchronous,
            extension
          ) || alteredData;
        }
        catch (error) {
          debug(
            'Skipping plugin %d due to %s%s%s\n%s\n%s%s%s%s\n',
            i,
            csi.HIFG.WHITE,
            error.message,
            csi.RESET,
            indent(error.stack, ' ', 2),
            csi.ON.BOLD,
            csi.HIFG.BLACK,
            indent(this.plugins[i].toString(), ' ', 4),
            csi.RESET
          );
        }
      }

      return alteredData;
    },
    enumerable: true,
    configurable: true,
    writable: true
  }
});

/**
 * This property getter returns the value of the hidden _getCache() function
 * when accessed. This works even if _getCache() is replaced by the static
 * CachedFile.setCacheGetter()
 *
 * @return {Object} the result of the internal _getCache() function call.
 */
Object.defineProperties(CachedFile, {
  cache: {
    enumerable: true,
    configurable: false,
    get: function __cachedfile_cache_getter_getter() {
      return _getCache();
    }
  },

  /**
   * This function swaps out the function used throughout the 'class' in order to
   * cache the loaded files. The supplied function to use in its place must return
   * a writable object or else unexpected errors may occur.
   *
   * @param {Function} fn a function to replace the default getCache
   * implementation
   */
  setCacheGetter: {
    value: function __cachedfile_cache_getter_setter(fn) {
      _getCache = fn;
    },
    enumerable: true,
    configurable: false,
    writable: false
  },

  /**
   * This function resets the default access to the _getCache function making
   * the CachedFile.cache property also return the original values in the case
   * that setCacheGetter() was invoked with undesireable effects.
   */
  resetCacheGetter: {
    value: function __cachedfile_cache_getter_resetter() {
      _getCache = _originalGetCache;
    },
    enumerable: true,
    configurable: false,
    writable: false
  }
});

module.exports = CachedFile;