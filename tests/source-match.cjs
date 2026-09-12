const assert = require('node:assert/strict');

function sourceVariants(value) {
  const compact = String(value).replace(/\s+/g, '');
  const normalizeArrowParams = (source) =>
    source.replace(/\(([A-Za-z_$][A-Za-z0-9_$]*)\)=>/g, '$1=>');
  const normalizeTrailingPunctuation = (source) =>
    source.replace(/,([)\]}])/g, '$1').replace(/;}/g, '}');

  return [
    compact,
    normalizeArrowParams(compact),
    normalizeTrailingPunctuation(compact),
    normalizeTrailingPunctuation(normalizeArrowParams(compact)),
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function compactPattern(pattern) {
  return new RegExp(pattern.source.replace(/\s+/g, ''), pattern.flags);
}

function matches(value, pattern) {
  return new RegExp(pattern.source, pattern.flags).test(value);
}

function matchCode(actual, pattern, message) {
  const compact = compactPattern(pattern);
  const variants = sourceVariants(actual);
  if (variants.some((value) => matches(value, compact))) return;
  assert.match(variants.at(-1), compact, message);
}

function doesNotMatchCode(actual, pattern, message) {
  const compact = compactPattern(pattern);
  for (const value of sourceVariants(actual)) {
    assert.doesNotMatch(value, new RegExp(compact.source, compact.flags), message);
  }
}

module.exports = { matchCode, doesNotMatchCode };
