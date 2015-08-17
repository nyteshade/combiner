module.exports = {
  Combiner: require('./combiners/Combiner'),
  CSSCombiner: require('./combiners/CSSCombiner'),
  JSCombiner: require('./combiners/JSCombiner'),
  PageNameCombiner: require('./combiners/PageNameCombiner').PageNameCombiner,
  NamedCombiner: require('./combiners/PageNameCombiner').NamedCombiner,
  helpers: require('./helpers/express'),
  middleware: {
    Preprocessor: require('./middleware/Preprocessor'),
    LESSPreprocessor: require('./middleware/LESSPreprocessor'),
    SASSPreprocessor: require('./middleware/SASSPreprocessor')
  }
};