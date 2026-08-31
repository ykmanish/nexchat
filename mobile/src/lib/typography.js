import { cloneElement } from 'react';
import { Text, TextInput } from 'react-native';
import { font } from '../theme';

/**
 * Makes Satre the default face for every `Text` and `TextInput`.
 *
 * The alternative is adding `fontFamily` to forty stylesheets and remembering
 * it in every new one, which is the kind of thing that is right on the day it
 * is written and drifts thereafter — one screen ends up in Roboto and nobody
 * notices for a month.
 *
 * `defaultProps` used to be the idiomatic way to do this, but React 19 removed
 * it for function components, and RN's Text is a forwardRef. Wrapping `render`
 * is what remains: the injected style goes *first*, so any explicit
 * `fontFamily` in a component — the Outfit headings, mainly — still wins.
 */
function withDefaultFont(Component, style) {
  if (!Component || Component.__chaxFontPatched) return;

  const original = Component.render;
  if (typeof original !== 'function') return;

  Component.render = function render(...args) {
    const element = original.apply(this, args);
    // Not a hand-built object: a React element carries internals ($$typeof,
    // key, ref, _owner) that spreading quietly drops, and React 19 is stricter
    // about elements it did not mint itself. cloneElement is the supported way
    // to add a prop, and it preserves all of that.
    if (!element || typeof element !== 'object') return element;

    return cloneElement(element, {
      style: [style, element.props?.style],
    });
  };

  Component.__chaxFontPatched = true;
}

withDefaultFont(Text, { fontFamily: font.body });
withDefaultFont(TextInput, { fontFamily: font.body });
