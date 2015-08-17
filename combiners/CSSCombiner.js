/**
 * CSSCombiner.js
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

var Combiner = require('./Combiner');
var isA = require('isa-lib')().isA;
var fs = require('fs');
var extend = require('extend');

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

module.exports = CSSCombiner;
