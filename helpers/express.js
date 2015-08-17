/**
 * helpers/express.js
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

var Combiner = require('../combiners/Combiner');
var JSCombiner = require('../combiners/JSCombiner');
var CSSCombiner = require('../combiners/CSSCombiner');

var isA = require('isa-lib')().isA;
var Q = require('q');
var request = require('request');
var csi = require('node-csi');
var fs = require('fs');
var pth = require('path');
var URL = require('url');
var extend = require('extend');


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
  var regex = isR(pathName)
      ? pathName
      : new RegExp("^\\/" + (pathName || "js") + "\\/(.*)$");

  if (additionalMiddleware) {
    middleware = [];

    if (isF(additionalMiddleware)) {
      middleware.push(middleware);
    }
    else if (isA(additionalMiddleware)) {
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

  var regex = isR(pathName)
      ? pathName
      : new RegExp("^\\/" + (pathName || "css") + "\\/(.*)$");

  if (additionalMiddleware) {
    var middleware = [];

    if (isF(additionalMiddleware)) {
      middleware.push(additionalMiddleware);
    }
    else if (isA(additionalMiddleware)) {
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

module.exports = {
  handleJS: handleJS,
  handleCSS: handleCSS,
  handleScriptAndStyle: handleScriptAndStyle
}