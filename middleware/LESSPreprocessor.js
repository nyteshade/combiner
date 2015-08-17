/**
 * LESSPreprocessor.js
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
var Preprocessor = require('./Preprocessor');
var lessLog = require('debug')('combiner:less');
var pth = require('path');

/**
 * The LESSPreprocessor is designed to sit in front of the acting Combiner and
 * precompile any LESS contents it encounters on the way. Information about the
 * compiled contents are stored in the res.locals variable. Additional info is
 * stored in the Combiner.globalCache for this type. (TODO probably will change)
 *
 * @author Brielle Harrison <nyteshade@gmail.com>
 *
 * @param {Object} config an object contianing properties that might affect the
 * workings of the Preprocessor in question
 */
function LESSPreprocessor(config) {
  if (this === global) { return new LESSPreprocessor(config); }

  // Invoke the parent constructor
  Preprocessor.call(this, config);
}

/**
 * Instance level properties and methods, extending from those defined within
 * Preprocessor.
 *
 * @type {Prototype}
 */
LESSPreprocessor.prototype = Object.create(Preprocessor.prototype, {
  /**
   * Function to be implemented by subclass. Its purpose is to determine what
   * the resulting asset's name is. Generally the result will be stored on
   * valueStore but this isn't necessary.
   *
   * It is imperative that deferred.resolve() or deferred.reject() is called.
   *
   * The context object is guaranteed to contain at least the req, res and app
   * variables related to the acting express app and current request.
   *
   * @param  {Q.defer()} deferred supplied by the invoker, a Q.defer() instance
   * @param  {Object} context a shared context object to read and write to
   * @return {Promise} the result of deferred.promise.
   */
  _determineAssetName: {
    value: function(deferred, context) {
      var req = context.req;
      var exts = ['.less'];
      var ext = pth.extname(req.url);

      if (exts.indexOf(ext) === -1) {
        lessLog('Skipping %s as %j is not in %j', req.url, ext, exts);
        return deferred.reject('Incorrect extension; skipping');
      }

      var root, prefix, assetName, pathToAsset, urlToAsset;

      root = config.lessRoot;
      prefix = config.lessPrefix || config.prefix || '';
      assetName = req.url.replace(prefix, '');
      pathToAsset = pth.join(root, assetName);
      urlToAsset = pathToAsset.replace(config.root, '');

      lessLog('[URL] %s', req.url);
      lessLog('[Root] %s', root);
      lessLog('[Prefix] %s', prefix);
      lessLog('[AssetName] %s', assetName);
      lessLog('[PathToAsset] %s', pathToAsset);
      lessLog('[UrlToAsset] %s', pathToAsset);

      context.root = root;
      context.prefix = prefix;
      context.assetName = assetName;
      context.pathToAsset = pathToAsset;
      context.urlToAsset = urlToAsset;

      deferred.resolve(context);
    },
    enumerable: true,
    configurable: true,
    writable: true
  },

  /**
   * Function to be implemented by subclass. Its purpose is to determine what
   * the resulting asset's name is. Generally the result will be stored on
   * context but this isn't necessary.
   *
   * Next will be invoked when this function calls resolve() on the supplied
   * deferred. If reject() is called on it instead, execution of the chain
   * ends here with this piece of middleware. Presumably, in this case, the
   * middleware has sent a response to the browser.
   *
   * The context object is guaranteed to also contain at least the req, res
   * and app variables related to the acting express app and current request
   * despite having been supplied as additional parameters for ease of use.
   * It also contains any values stored within during the lifecycle calls to
   * get the asset name and existence before executing this function.
   *
   * @param {Q.defer()} deferred use this to resolve() or reject() and in so
   * doing move on and call next() or quit; respectively
   * @param {Object} context a shared context object to read and write to
   * @param {Request} req an Express request object
   * @param {Response} res an Express response object
   */
  _middleware: {
    value: function (deferred, context, req, res, app) {
      var fs = require('fs');
      var less = require('less');
      var pathToAsset = context.pathToAsset;

      // Should I be making requests?
      fs.readFile(pathToAsset, function(err, contents) {
        if (err) {
          lessLog('%s', JSON.stringify(err, null, "  "));
          deferred.resolve('Skipping to next middleware');
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
            root: context.root,
            path: context.pathToAsset,
            prefix: context.prefix,
            file: context.urlToAsset
          };

          res.locals.CSS = res.locals.CSS || [];
          res.locals.CSS.push(context.urlToAsset);

          lessLog('LESS compiled and stored for %s', context.assetName);
          deferred.resolve('LESS compiled and stored for ' + pathToAsset);
        });
      });
    },
    enumerable: true,
    configurable: true,
    writable: true
  },

  /**
   * Function to be implemented by subclass. Its purpose is to determine what
   * the resulting asset's name is. Generally the result will be stored on
   * valueStore but this isn't necessary.
   *
   * The context object is guaranteed to contain at least the req, res and app
   * variables related to the acting express app and current request.
   *
   * @param  {Q.defer()} deferred supplied by the invoker, a Q.defer() instance
   * @param  {Object} context a shared context object to read and write to
   * @return {Promise} the result of deferred.promise.
   */
  _shouldPreprocess: {
    value: function(deferred, context) {
      if (!this.config.lessRoot) {
        lessLog('No lessRoot defined. Bailing');
        deferred.reject();
      }
      deferred.resolve();
    },
    enumerable: true,
    configurable: true,
    writable: true
  }
});

module.exports = LESSPreprocessor;

