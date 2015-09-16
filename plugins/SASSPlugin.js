/**
 * SASSPlugin.js
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
var sass = require('node-sass');
var path = require('path');
var extend = require('extend');
var debug = require('debug')('combiner:SASSPlugin');
var paths = [];

/**
 * A CachedFile plugin that takes the data loaded from disk for files ending
 * in a .scss or .sass extension and renders the LESS data as the resulting
 * modified output.
 *
 * @param {String} data the raw file loaded from disk
 * @param {Boolean} synchronous true if the operation is synchronous
 * @param {String} extension the file extension of the loaded file, in all
 * lower cased letters
 * @returns {String} the modified or original data
 */
function SASSPlugin(data, synchronous, extension) {
  if (extension === '.sass' || extension === '.scss') {
    debug('compiling SASS/SCSS code');
    data = sass.renderSync({
      data: data,
      includePaths: [path.dirname(this.path)].concat(paths)
    }).css;
  }

  return data;
}

Object.defineProperties(SASSPlugin, {
  /**
   * This array, if set on SASSPlugin, will be concatenated to the default
   * include paths allowing additional app specific locations for things like
   * mixins to exist elsewhere in the site. The paths are expected to be
   * non-relative paths.
   */
  additionalPaths: {
    get: function() {
      return paths;
    },

    set: function(value) {
      paths = value || [];
    },

    configurable: false,
    enumerable: true
  }
});

module.exports = SASSPlugin;