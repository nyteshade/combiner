/**
 * BabelPlugin.js
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
var debug = require('debug')('combiner:BabelPlugin');

/**
 * This function is what is exported via require(). The resulting function
 * should be executed to generate the plugin function. Calling it without
 * any values for config will setup the default values for the Babel plugin
 * operation.
 *
 * @param  {Object} config an object that, if supplied, will be passed on to
 * the babel.transform call.
 * @return {Function} a drop in plugin compatible with the Combiner CachedFile
 * instance.
 */
module.exports = function __generateBabelPlugin(config) {
  // The extensions array is a property used by this function, the rest are
  // babel specific plugins. See http://babeljs.io/docs/usage/options/ for
  // more details.
  var babelCfg = extend(true, {
    extensions: ['.js', '.es6', '.es2015'],
    stage: 1,
    retainLines: true
  }, config || {});


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
  return function BabelPlugin(data, synchronous, extension) {
    var extensions = babelCfg.extensions || ['.es6', '.es2015'];
    delete babelCfg.extensions;

    if (extensions.indexOf(extension) === -1) {
      return data;
    }

    debug('Transpiling ES2015 code...')
    try {
      return babel.transform(data, babelCfg).code;
    }
    catch (error) {
      console.error('%sBABEL ERROR%s: %s\n%s%s%s',
        csi.FG.RED,
        csi.FG.RESET,
        error.message,
        csi.HIFG.BLACK,
        indent(error.stack, ' ', 4),
        csi.RESET
      );
      debug('Skipping transpile');

      return data;
    }
  };
};


