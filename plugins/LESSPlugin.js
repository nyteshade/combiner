/**
 * LESSPlugin.js
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
var less = require('less');
var debug = require('debug')('combiner:LESSPlugin');

/**
 * A CachedFile plugin that takes the data loaded from disk for files ending
 * in a .less extension and renders the LESS data as the resulting modified
 * output.
 *
 * @param {String} data the raw file loaded from disk
 * @param {Boolean} synchronous true if the operation is synchronous
 * @param {String} extension the file extension of the loaded file, in all
 * lower cased letters
 * @returns {String} the modified or original data
 */
function LESSPlugin(data, synchronous, extension) {
  if (extension === '.less' && !synchronous) {
    // Asynchronous issue here. LESS data will appear fixed shortly
    // after the compilation starts but not immediately when readFile()
    // returns (assuming synchronized)
    debug('compiling LESS code');
    this.deferreds.less = Q.defer();
    less.render(data).then((function(output) {
      this.deferreds.less.resolve(output.css);
      this.data = output.css;
    }).bind(this));
  }

  return data;
}

module.exports = LESSPlugin;