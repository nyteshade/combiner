/**
 * CSSPlugin.js
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
 */

var Q = require('q');
var babel = require('babel');
var extend = require('extend');
var indent = require('indent-string');
var csi = require('node-csi');
var isA = require('isa-lib')().isA;
var path = require('path');
var debug = require('debug')('combiner:CSSPlugin');

/**
 * This function is what is exported via require(). The resulting function
 * should be executed to generate the plugin function. Calling it without
 * any values for config will setup the default configuration for the plugin
 *
 * @param  {Object} config an object that, if supplied, will be passed on to
 * the babel.transform call.
 * @return {Function} a drop in plugin compatible with the Combiner CachedFile
 * instance.
 */
module.exports = function __generateCSSPlugin(config) {
  /**
   * A CachedFile plugin that takes the data loaded from disk for files ending
   * in a .es6 extension and renders the LESS data as the resulting
   * modified output.
   *
   * @param {String} data the raw file loaded from disk
   * @param {Boolean} synchronous true if the operation is synchronous
   * @param {String} extension the file extension of the loaded file, in all
   * lower cased letters
   * @returns {String} the modified or original data
   */
  function CSSPlugin(data, synchronous, extension) {
    var dirname = path.dirname(this.path);
    var searchStr, valueStr;
    var cfg = CSSPlugin.config;
    var replacements = [].concat(cfg.replacements);

    for (var i = 0; i < replacements.length; i++) {
      if (replacements.length < 2) {
        debug('Skipping replacement %j as it is missing enough params',
            replacements[i]);
        continue;
      }

      searchStr = replacements[i][0];
      valueStr = replacements[i][1].replace(/@path/g, dirname);

      data = data.replace(searchStr, valueStr);

      debug('CSSPlugin replacing %j with "%s"', searchStr, valueStr);
    }

    return data;
  }

  Object.defineProperties(CSSPlugin, {
    /**
     * A property with a getter and setter that allows dynamic access to the
     * config object used by the CSSPlugin.
     *
     * @type {Object} the configuration object for the CSSPlugin
     */
    config: {
      enumerable: true,
      configurable: false,
      get: function __getConfig() {
        return _cfg;
      },
      set: function __setConfig(value) {
        _cfg = value;
      }
    },

    /**
     * Allows the configuration for this CSSPlugin to be easily extended
     * to have different properties than those of the default or existing
     * configuration. Values in the supplied object will be overlaid onto
     * the existing _cfg object. To replace the value altogether, assign
     * an object to CSSPlugin.config.
     *
     * @param {Object} object an object with new properties that should be
     * overlaid onto the existing _cfg object.
     */
    extendConfig: {
      value: function __extendConfigWith(object) {
        extend(true, _cfg, object);
      },
      enumerable: true,
      configuable: false,
      writable: false
    },

    /**
     * This replaces all paths in the code starting with "'../" or "'./",
     * with the full directory of the cached file followed by the original path
     *
     * @type {Array}
     */
    DEFAULT_REPLACEMENT: {
      enumerable: true,
      configurable: false,
      get: function __getDefaultReplacer() {
        return [ new RegExp("(['\"])(\.\.?)\/", 'g'), '$1@path/$2/'];
      }
    }
  });

  var _cfg = extend(true, {
    // Replacements are iterated over. Each one is evaluated against the whole
    // source code for this file. In the replacement string, @path will be
    // replaced with the directory name of the cached file on disk.
    //
    // The syntax for replacements is an array of arrays. The arrays within
    // replacements should each have two values. The first being the search
    // string or regular expression and the second being the replacement string.
    //
    // The default replacemetn can be accessed outside of this code by
    // referencing CSSPlugin.DEFAULT_REPLACEMENT.
    replacements: [
      CSSPlugin.DEFAULT_REPLACEMENT
    ]
  }, config || {});

  return CSSPlugin;
};


