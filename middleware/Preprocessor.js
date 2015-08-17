/**
 * Preprocessor.js
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

var extend = require('extend');
var preLog = require('debug')('combiner:preprocessor');
var Q = require('q');

/**
 * The Preprocessor middleware is a base class that is designed to be extended
 * for more specific edge cases. It presumes there is some asset detectable via
 * request, response or express/app objects. As the various extended functions
 * are overwritten by the subclasses, a valueStore object is passed around with
 * every invocation of the Preprocessor.
 *
 * By default, this object has req, res and app for use in detecting the
 * location of assets relative to the project, detecting their existence and
 * modifying state based on such.
 *
 * @author Brielle Harrison <nyteshade@gmail.com>
 *
 * @param {Object} config an object contianing properties that might affect the
 * workings of the Preprocessor in question
 */
function Preprocessor(config) {
  // Ensure we are creating an instance. If invoked as a function, return
  // a new invocation of it instead.
  if (this === global) {
    return new Preprocessor(config);
  }

  // Assign the config or create a default one if none is supplied.
  this.config = config || {
    existencePrecedence: Preprocessor.FILE_SYSTEM
  };

  // Set the default existence precedence for this preprocessor
  this.existencePrecedence = this.config.existencePrecedence;
}

/**
 * Instance level properties and methods
 * @type {Prototype}
 */
Preprocessor.prototype = {
  /** @type {Object} the preprocessor configuration object */

  /**
   * {String} property, determining which check is more important if both
   * properties (pathToAsset and urlToAsset) exist: FILE_SYSTEM, NETWORK or
   * BOTH_FS_AND_NET.
   */
  existencePrecedence: Preprocessor.FILE_SYSTEM,

  /**
   * A function that, based on the implementation of _determineAssetName,
   * calculates the name and path to the asset in question. The private function
   * is contractually obligated to write, at least, the following properties
   * to the supplied valueStore once the promise it returns is resolved.
   *
   *   pathToAsset
   *   urlToAsset [optional]
   *   assetName
   *
   * @return {Promise} a promise that completes once the file name info has
   * been noted on the object.
   */
  determineAssetName: function _preprocessor_determineAssetName(valueStore) {
    preLog('determining file name...');
    var defer = Q.defer();
    this._determineAssetName.call(this, defer, valueStore);
    return defer.promise;
  },

  /**
   * A function that, based on the implementation of _doesAssetExist,
   * calculates the existence of the file in question. A default implementation
   * of _doesAssetExist is provided that either the file system or network or
   * both as per the value of existencePrecedence. The boolean value exists
   * will be populated after this call's innerworkings have completed.
   *
   * @return {Promise} a promise that is resolved when the existence, as per
   * the instance property existencePrecedence, has been determined.
   */
  doesAssetExist: function _preprocessor_doesAssetExist(valueStore) {
    preLog('checking for file existence...');
    var defer = Q.defer();
    this._doesAssetExist.call(this, defer, valueStore);
    return defer.promise;
  },

  /**
   * The entry point for the preprocessor specific logic. This function is
   * responsible for invoking determineFileName, doesAssetExist
   * @param  {[type]}   req  [description]
   * @param  {[type]}   res  [description]
   * @param  {Function} next [description]
   * @return {[type]}        [description]
   */
  middleware: function _preprocessor_middleware(req, res, next) {
    var valueStore = {
      req: req,
      res: res,
      app: req.app
    };

    var self = this;

    this.shouldPreprocess(valueStore).then(
      // Invoked when _shouldPreprocess resolves its deferred.
      function _spSuccess(shouldPreprocessValue) {
        self.determineAssetName(valueStore).then(
          // Invoked when _determineAssetName resolves its deferred
          function _danSuccess(assetNameValue) {
            self.doesAssetExist(valueStore).then(
              // Invoked when _doesAssetExist resolves its deferred
              function _daeSuccess(assetExistsValue) {
                // Prepare a deferred so we know when to call next() or if we
                // should avoid doing so.
                var defer = Q.defer();

                // Invoke the subclass' primary function.
                self._middleware(
                  defer,      // A deferred to signal when its finished
                  valueStore, // The shared context built to this point
                  req,        // The Express request object
                  res,        // The Express response object
                  req.app     // The Express app object
                );

                // The deferred sent to the _middleware function as a parameter
                // will signal when the process is done and ready to move on
                // to the next steps.
                defer.promise.then(
                  function _middlewareReadyForNext() {
                    next();
                  },
                  function _middlewareBreakingChain() {
                    preLog(
                      'Skipping next(). Presumably middleware sent response'
                    );
                  }
                );
              },
              // Invoked when _doesAssetExist rejects its deferred
              function _daeFailure(assetExistsReason) {
                preLog('DAEFailure: ', assetExistsReason);
                next();
              }
            )
          },
          // Invoked when _determineAssetName rejects its deferred
          function _danFailure(assetNameReason) {
            preLog('DANFailure: ', assetNameReason);
            next();
          }
        )
      },
      // Invoked when _shouldPreprocess rejects its deferred
      function _spFailure(shouldPreprocessReason) {
        preLog('SPFailure: ', shouldPreprocessReason);
        next();
      }
    );
  },

  /**
   * A function that, based on the implementation of _shouldPreprocess,
   * calculates whether or not to proceed. If the function should not proceed
   * simply throw an error or reject the deferred supplied.
   *
   * @param  {Object} valueStore a persisted scope within which to write values
   * @return {[type]} a promise
   */
  shouldPreprocess: function(valueStore) {
    var defer = Q.defer();
    this._shouldPreprocess.call(this, defer, valueStore);
    return defer.promise;
  },

  /**
   * Function to be implemented by subclass. Its purpose is to determine what
   * the resulting asset's name is. Generally the result will be stored on
   * valueStore but this isn't necessary.
   *
   * It is imperative that deferred.resolve() or deferred.reject() is called.
   *
   * The valueStore object is guaranteed to contain at least the req, res and
   * app variables related to the acting express app and current request.
   *
   * @param  {Q.defer()} deferred supplied by the invoker, a Q.defer() instance
   * @param  {Object} valueStore a shared context object to read and write to
   * @return {Promise} the result of deferred.promise.
   */
  _determineAssetName: function(deferred, valueStore) {
    deferred.reject('_determineAssetName has not been defined.');
  },

  /**
   * Function to be implemented by subclass. Its purpose is to determine if
   * the resulting asset's exists. Generally the result will be stored on
   * valueStore but this isn't necessary.
   *
   * It is imperative that deferred.resolve() or deferred.reject() is called.
   *
   * The valueStore object is guaranteed to contain at least the req, res and
   * app variables related to the acting express app and current request.
   *
   * @param  {Q.defer()} deferred supplied by the invoker, a Q.defer() instance
   * @param  {Object} valueStore a shared context object to read and write to
   * @return {Promise} the result of deferred.promise.
   */
  _doesAssetExist: function(deferred, valueStore) {
    switch(this.existencePrecedence) {
      case Preprocessor.NETWORK:
        deferred.reject('Network is not yet implemented');
        break;

      case Preprocessor.BOTH_FS_AND_NET:
        preLog('Network is not yet implemented, using file system');

      default:
      case Preprocessor.FILE_SYSTEM:
        var fs = require('fs');
        if (!valueStore.pathToAsset) {
          deferred.reject('valueStore.pathToAsset not defined');
        }
        else {
          fs.exists(valueStore.pathToAsset, function(exists) {
            if (exists) {
              valueStore.exists = exists;
              deferred.resolve();
            }
            else {
              deferred.reject(valueStore.pathToAsset + ' does not exist.');
            }
          });
        }
        break;
    }
  },

  /**
   * Function to be implemented by subclass. Its purpose is to determine what
   * the resulting asset's name is. Generally the result will be stored on
   * valueStore but this isn't necessary.
   *
   * Next will be invoked when this function calls resolve() on the supplied
   * deferred. If reject() is called on it instead, execution of the chain
   * ends here with this piece of middleware. Presumably, in this case, the
   * middleware has sent a response to the browser.
   *
   * The valueStore object is guaranteed to also contain at least the req, res
   * and app variables related to the acting express app and current request
   * despite having been supplied as additional parameters for ease of use.
   * It also contains any values stored within during the lifecycle calls to
   * get the asset name and existence before executing this function.
   *
   * @param {Q.defer()} deferred use this to resolve() or reject() and in so
   * doing move on and call next() or quit; respectively
   * @param {Object} valueStore a shared context object to read and write to
   * @param {Request} req an Express request object
   * @param {Response} res an Express response object
   */
  _middleware: function (deferred, valueStore, req, res, app) {
    deferred.reject('_middleware has not been defined.')
  },

  /**
   * Function to be implemented by subclass. Its purpose is to determine what
   * the resulting asset's name is. Generally the result will be stored on
   * valueStore but this isn't necessary.
   *
   * @param  {Q.defer()} deferred supplied by the invoker, a Q.defer() instance
   * @param  {Object} valueStore a shared context object to read and write to
   * @return {Promise} the result of deferred.promise.
   */
  _shouldPreprocess: function(deferred, valueStore) {
    deferred.reject('_shouldPreprocess has not been defined.');
  }
};

/**
 * Static methods and properties
 */
extend(true, Preprocessor, {
  /** Constant denoting to check existence on the file system. */
  FILE_SYSTEM: 'Check the file system instead',

  /** Constant denoting to check existence over the network. */
  NETWORK: 'Check the URL if present, instead, by making a network call',

  /**
   * Constant denoting that existence of the asset must be verified over the
   * network AND on the filesystem.
   */
  BOTH_FS_AND_NET: 'File only exists if both are positive results'
});

module.exports = Preprocessor;