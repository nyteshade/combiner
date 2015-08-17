/**
 * PageNameCombiner.js
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
var Q = require('q');
var request = require('request');
var pth = require('path');
var extend = require('extend');

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

module.exports = {
  PageNameCombiner: PageNameCombiner,
  NamedCombiner: NamedCombiner
};