/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';
const l = Symbol.for("react.element"),
  n = Symbol.for("react.portal"),
  p = Symbol.for("react.fragment"),
  q = Symbol.for("react.strict_mode"),
  r = Symbol.for("react.profiler"),
  t = Symbol.for("react.provider"),
  u = Symbol.for("react.context"),
  v = Symbol.for("react.forward_ref"),
  w = Symbol.for("react.suspense"),
  x = Symbol.for("react.memo"),
  y = Symbol.for("react.lazy"),
  z = Symbol.iterator;

function A(a) {
  if (null === a || "object" !== typeof a) return null;
  a = z && a[z] || a["@@iterator"];
  return "function" === typeof a ? a : null
}
const B = {
    isMounted: function() {
      return !1
    },
    enqueueForceUpdate: function() {},
    enqueueReplaceState: function() {},
    enqueueSetState: function() {}
  },
  C = Object.assign,
  D = {};

function E(a, b, d) {
  this.props = a;
  this.context = b;
  this.refs = D;
  this.updater = d || B
}
E.prototype.isReactComponent = {};
E.prototype.setState = function(a, b) {
  if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
  this.updater.enqueueSetState(this, a, b, "setState")
};
E.prototype.forceUpdate = function(a) {
  this.updater.enqueueForceUpdate(this, a, "forceUpdate")
};

function F() {}
F.prototype = E.prototype;

function G(a, b, d) {
  this.props = a;
  this.context = b;
  this.refs = D;
  this.updater = d || B
}
const H = G.prototype = new F;
H.constructor = G;
C(H, E.prototype);
H.isPureReactComponent = !0;
const I = Array.isArray,
  J = Object.prototype.hasOwnProperty,
  K = {
    current: null
  },
  L = {
    key: !0,
    ref: !0,
    __self: !0,
    __source: !0
  };

function M(a, b, d) {
  let e, c = {},
    k = null,
    h = null;
  if (null != b)
    for (e in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, e) && !L.hasOwnProperty(e) && (c[e] = b[e]);
  const f = arguments.length - 2;
  if (1 === f) c.children = d;
  else if (1 < f) {
    for (var g = Array(f), m = 0; m < f; m++) g[m] = arguments[m + 2];
    c.children = g
  }
  if (a && a.defaultProps)
    for (e in f = a.defaultProps, f) void 0 === c[e] && (c[e] = f[e]);
  return {
    $$typeof: l,
    type: a,
    key: k,
    ref: h,
    props: c,
    _owner: K.current
  }
}

function N(a, b) {
  return {
    $$typeof: l,
    type: a.type,
    key: b,
    ref: a.ref,
    props: a.props,
    _owner: a._owner
  }
}

function O(a) {
  return "object" === typeof a && null !== a && a.$$typeof === l
}

function P(a) {
  const b = {
    "=": "=0",
    ":": "=2"
  };
  return "$" + a.replace(/[=:]/g, function(a) {
    return b[a]
  })
}
const Q = /\/+/g;

function R(a, b) {
  return "object" === typeof a && null !== a && null != a.key ? P("" + a.key) : b.toString(36)
}

function S(a, b, d, e, c) {
  const k = {},
    h = null,
    f = null;
  if (null != b)
    for (var g in void 0 !== b.ref && (f = b.ref), void 0 !== b.key && (h = "" + b.key), b) J.call(b, g) && !L.hasOwnProperty(g) && (k[g] = b[g]);
  const m = arguments.length - 2;
  if (1 === m) k.children = d;
  else if (1 < m) {
    for (var T = Array(m), U = 0; U < m; U++) T[U] = arguments[U + 2];
    k.children = T
  }
  if (a && a.defaultProps)
    for (var V in m = a.defaultProps, m) void 0 === k[V] && (k[V] = m[V]);
  return {
    $$typeof: l,
    type: a,
    key: h,
    ref: f,
    props: k,
    _owner: K.current
  }
}

function V(a) {
  if (null == a) return a;
  const b = [];
  return W(a, b, "", "", function(a) {
    return a
  }), b
}

function W(a, b, d, e, c) {
  let k = 0,
    h = 0,
    f = 0,
    g = 0;
  if (Array.isArray(d))
    for (let m = 0; m < d.length; m++) {
      let T = d[m];
      k = W(T, b, e, c(T, m))
    } else if ("object" === typeof d && null !== d) {
      if ("function" === typeof d.then) return d.then(function(a) {
        return W(a, b, e, c)
      }, function(a) {
        throw a;
      });
      if (d.$$typeof === l || d.$$typeof === n) return f = c(d), b.push(f), 1;
      if ("function" === typeof(T = A(d))) {
        e = T.call(d);
        for (let U = 0; !(T = e.next()).done;) k += W(T.value, b, d, c);
        return k
      }
    } else "string" === typeof d || "number" === typeof d ? (f = c(d), b.push(f), 1) : "function" === typeof d && (f = c(d.call(null)), b.push(f), 1);
  return k
}
const ba = {
  current: null
};

function ca(a) {
  const b = ba.current;
  return b && b.getChildContext ? b.getChildContext() : a
}
class da {
  constructor(a, b) {
    this.queue = a;
    this.baseState = b;
    this.next = null
  }
}
class ea {
  constructor() {
    this.first = this.last = null
  }
}

function fa(a, b) {
  const d = a.alternate,
    e = a.updateQueue,
    c = e.last;
  let k = e.first;
  if (null !== c && c.next === k) {
    const h = c.next;
    c.next = null;
    let f = k,
      g = null,
      m = null;
    do {
      const T = f.callback;
      null !== T && (f.callback = null, (null === m ? g = m = [] : m.push(T)).push(T));
      if (null !== d && (null === d.updateQueue || d.updateQueue.last !== f)) {
        const U = f.next;
        f.next = null;
        f = U
      } else f = f.next
    } while (null !== f);
    null !== m && (b.flags |= 32);
    null !== g && (e.shared.interleaved = g)
  }
}

function ga(a, b) {
  const d = a.updateQueue,
    e = a.pendingProps;
  if (null !== e && void 0 !== e.children) {
    const c = d.shared;
    null !== c.interleaved && (b.flags |= 1024, c.pending = c.interleaved.pop());
    const k = e.children;
    null !== k && (d.pending = k)
  }
}
const ha = {
  isMounted: function(a) {
    return !1
  },
  enqueueSetState: function(a, b, d) {
    a = a._reactInternals;
    const e = ia(),
      c = ja(a);
    c.lane = e;
    c.revertLane = 0;
    c.tag = 0;
    const k = c.payload;
    void 0 === b && (b = null);
    null !== b && (c.payload = b);
    void 0 !== d && null !== d && ("function" === typeof d && (c.callback = d));
    ka(a, c)
  },
  enqueueReplaceState: function(a, b, d) {
    a = a._reactInternals;
    const e = ia(),
      c = ja(a);
    c.lane = e;
    c.revertLane = 0;
    c.tag = 1;
    c.payload = b;
    void 0 !== d && null !== d && ("function" === typeof d && (c.callback = d));
    ka(a, c)
  },
  enqueueForceUpdate: function(a, b) {
    a = a._reactInternals;
    const d = ia(),
      e = ja(a);
    e.lane = d;
    e.revertLane = 0;
    e.tag = 2;
    void 0 !== b && null !== b && ("function" === typeof b && (e.callback = b));
    ka(a, e)
  }
};
var Children = {
  map: V,
  forEach: function(a, b, d) {
    V(a, function() {
      b.apply(this, arguments)
    }, d)
  },
  count: function(a) {
    let b = 0;
    return V(a, function() {
      b++
    }), b
  },
  toArray: V,
  only: function(a) {
    if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
    return a
  }
};
var Component = E;
var PureComponent = G;
var createContext = function(a) {
  a = {
    $$typeof: u,
    _currentValue: a,
    _currentValue2: a,
    _threadCount: 0,
    Provider: null,
    Consumer: null
  };
  a.Provider = {
    $$typeof: t,
    _context: a
  };
  return a.Consumer = a
};
var createElement = M;
var createRef = function() {
  return {
    current: null
  }
};
var forwardRef = function(a) {
  return {
    $$typeof: v,
    render: a
  }
};
var lazy = function(a) {
  return {
    $$typeof: y,
    _payload: {
      _status: -1,
      _result: a
    },
    _init: function(a) {
      if (-1 === a._status) {
        let b = a._result;
        a._status = 0;
        a._result = b()
      }
      if (0 === a._status) {
        let d = a._result;
        d.then(function(b) {
          a._status = 1;
          a._result = b
        }, function(b) {
          a._status = 2;
          a._result = b
        })
      }
    }
  }
};
var memo = function(a, b) {
  return {
    $$typeof: x,
    type: a,
    compare: void 0 === b ? null : b
  }
};
var __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = ba;
var cloneElement = function(a, b, d) {
  if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
  let e = C({}, a.props),
    c = a.key,
    k = a.ref,
    h = a._owner;
  if (null != b) {
    void 0 !== b.ref && (k = b.ref, h = K.current);
    void 0 !== b.key && (c = "" + b.key);
    if (a.type && a.type.defaultProps) var f = a.type.defaultProps;
    for (g in b) J.call(b, g) && !L.hasOwnProperty(g) && (e[g] = void 0 === b[g] && void 0 !== f ? f[g] : b[g])
  }
  var g = arguments.length - 2;
  if (1 === g) e.children = d;
  else if (1 < g) {
    f = Array(g);
    for (let m = 0; m < g; m++) f[m] = arguments[m + 2];
    e.children = f
  }
  return {
    $$typeof: l,
    type: a.type,
    key: c,
    ref: k,
    props: e,
    _owner: h
  }
};
var createFactory = function(a) {
  const b = M.bind(null, a);
  b.type = a;
  return b
};
var isValidElement = O;
var version = "18.3.1";
var experimental_useOptimistic = function(a, b) {
  return a
};
var use = function(a) {
  return a
};
var useCallback = function(a, b) {
  return a
};
var useContext = function(a) {
  return a._currentValue
};
var useDebugValue = function() {};
var useDeferredValue = function(a, b) {
  return a
};
var useEffect = function() {};
var useId = function() {
  return ""
};
var useImperativeHandle = function() {};
var useInsertionEffect = function() {};
var useLayoutEffect = function() {};
var useMemo = function(a, b) {
  return a()
};
var useReducer = function(a, b, d) {
  return d ? d(b) : b
};
var useRef = function(a) {
  return {
    current: a
  }
};
var useState = function(a) {
  return "function" === typeof a ? [a(), function() {}] : [a, function() {}]
};
var useSyncExternalStore = function(a, b, d) {
  return b()
};
var useTransition = function() {
  return [function(a) {
    a()
  }, !1]
};
var Fragment = p;
var Profiler = r;
var StrictMode = q;
var Suspense = w;
var startTransition = function(a, b) {
  a()
};
export {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  cloneElement,
  createContext,
  createElement,
  createFactory,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  use,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
  experimental_useOptimistic as unstable_useOptimistic
};
export default {
    createElement,
    Component,
    Fragment
};