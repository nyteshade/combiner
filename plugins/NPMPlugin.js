/**
 * NPMPlugin.js
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
var extend = require('extend');
var indent = require('indent-string');
var csi = require('node-csi');
var debug = require('debug')('combiner:NPMPlugin');
var path = require('path');

/**
 * This function is what is exported via require(). The resulting function
 * should be executed to generate the plugin function. Calling it without
 * any values for config will setup the default values for the NPM plugin
 * operation.
 *
 * The NPMPlugin injects four variables before and after each file in a given
 * bundle
 *
 * @param  {Object} config an object that, if supplied, will be passed on to
 * the babel.transform call.
 * @return {Function} a drop in plugin compatible with the Combiner CachedFile
 * instance.
 */
module.exports = function __generateNPMPlugin(config) {
  // The extensions array is a property used by this function, the rest are
  // babel specific plugins. See http://babeljs.io/docs/usage/options/ for
  // more details.
  var npmCfg = extend(true, {
    extensions: ['.js', '.es6', '.es2015'],
    requiredPathParts: ['/node_modules/', '/npm/']
  }, (config || {}));

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
  return function NPMPlugin(data, synchronous, extension) {
    var extensions = npmCfg.extensions || ['.js', '.es6', '.es2015'];
    delete npmCfg.extensions;

    // If the extension doesn't match, bail out...
    if (extensions.indexOf(extension) === -1) {
      return data;
    }

    // Check to see if the path contains at least one of the required path
    // parts to be processed by the NPMPlugin. Generally this is one of
    // node_modules or npm. These can be specified in the configuration options
    // for this plugin.
    var foundOne = false;
    for (var i = 0; i < npmCfg.requiredPathParts.length; i++) {
      var part = npmCfg.requiredPathParts[i];
      if (this.path.indexOf(part) !== -1) {
        foundOne = true;
        break;
      }
    }

    // If we haven't found a single item, then escape out of here and don't
    // bloat the code unnecessarily.
    if (!foundOne) {
      return data;
    }

    debug('injecting browserified NPM globals...');

    // Using ES6 string templates for this (requires node --harmony)
    var nuData = `
      window.__filename = '${this.path}';
      window.__dirname = '${path.dirname(this.path)}';
      window['global'] = window;
      window.module = {file: '${path.basename(this.path, extension)}'};
      Object.defineProperty(module, 'exports', {
        set: function(obj) {
          window[module.file] = obj;
          window.modules = window.modules || {};
          window.modules[module.file] = obj;
        }
      });
    ` + data + `
      delete window.__filename, window.__dirname, window.module, window.global;
    `;

    return nuData;
  };
};


