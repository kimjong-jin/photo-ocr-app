/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A minimal, self-contained, browser-friendly ESM implementation
 * of the React JSX runtime.
 */
const REACT_ELEMENT_TYPE = Symbol.for('react.element');
const REACT_FRAGMENT_TYPE = Symbol.for('react.fragment');

const hasOwnProperty = Object.prototype.hasOwnProperty;

const RESERVED_PROPS = {
  key: true,
  ref: true,
  __self: true,
  __source: true,
};

function jsx(type, config, maybeKey) {
  const props = {};
  let key = null;
  let ref = null;

  if (maybeKey !== undefined) {
    key = '' + maybeKey;
  }

  if (config.key !== undefined) {
    key = '' + config.key;
  }
  
  if (config.ref !== undefined) {
    ref = config.ref;
  }

  for (const propName in config) {
    if (
      hasOwnProperty.call(config, propName) &&
      !RESERVED_PROPS.hasOwnProperty(propName)
    ) {
      props[propName] = config[propName];
    }
  }

  if (type && type.defaultProps) {
    const defaultProps = type.defaultProps;
    for (const propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }

  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    key,
    ref,
    props,
    _owner: null, // This is fine for rendering purposes in this context.
  };
}

export const Fragment = REACT_FRAGMENT_TYPE;
export { jsx, jsx as jsxs };
