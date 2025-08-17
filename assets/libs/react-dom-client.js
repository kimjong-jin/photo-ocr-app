import * as React from './react.js';

var DOM_NODE_TYPE = {
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_FRAGMENT_NODE: 11
};

var REACT_ELEMENT_TYPE = Symbol.for('react.element');
var REACT_PORTAL_TYPE = Symbol.for('react.portal');
var REACT_FRAGMENT_TYPE = Symbol.for('react.fragment');
var REACT_STRICT_MODE_TYPE = Symbol.for('react.strict_mode');
var REACT_PROFILER_TYPE = Symbol.for('react.profiler');
var REACT_PROVIDER_TYPE = Symbol.for('react.provider');
var REACT_CONTEXT_TYPE = Symbol.for('react.context');
var REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref');
var REACT_SUSPENSE_TYPE = Symbol.for('react.suspense');
var REACT_SUSPENSE_LIST_TYPE = Symbol.for('react.suspense_list');
var REACT_MEMO_TYPE = Symbol.for('react.memo');
var REACT_LAZY_TYPE = Symbol.for('react.lazy');
var REACT_BLOCK_TYPE = Symbol.for('react.block');
var REACT_SERVER_BLOCK_TYPE = Symbol.for('react.server.block');
var REACT_FUNDAMENTAL_TYPE = Symbol.for('react.fundamental');
var REACT_SCOPE_TYPE = Symbol.for('react.scope');
var REACT_OPAQUE_ID_TYPE = Symbol.for('react.opaque.id');
var REACT_DEBUG_TRACING_MODE_TYPE = Symbol.for('react.debug_trace_mode');
var REACT_OFFSCREEN_TYPE = Symbol.for('react.offscreen');
var REACT_LEGACY_HIDDEN_TYPE = Symbol.for('react.legacy_hidden');

function getIteratorFn(maybeIterable) {
  if (maybeIterable === null || typeof maybeIterable !== 'object') {
    return null;
  }

  var P = typeof Symbol === 'function' ? Symbol.iterator : '@@iterator';
  var getSymbols = maybeIterable[P];

  if (typeof getSymbols === 'function') {
    return getSymbols;
  }

  return null;
}

var ReactSharedInternals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

function get(key) {
  return key._reactInternals;
}

function set(key, value) {
  key._reactInternals = value;
}

var NoFlags = 0;
var Placement = 2;
var Update = 4;
var Deletion = 8;
var ChildDeletion = 16;
var ContentReset = 32;
var Callback = 64;
var DidCapture = 128;
var Ref = 256;
var Snapshot = 512;
var Passive = 1024;
var Hydrating = 2048;
var HydratingAndUpdate = Hydrating | Update;
var LifecycleEffectMask = Passive | Update | Callback | Ref | Snapshot;
var HostEffectMask = 32767;
var Incomplete = 2048;
var ShouldCapture = 4096;
var ForceUpdateForLegacySuspense = 16384;
var Forked = 1048576;

var FunctionComponent = 0;
var ClassComponent = 1;
var IndeterminateComponent = 2;
var HostRoot = 3;
var HostPortal = 4;
var HostComponent = 5;
var HostText = 6;
var Fragment = 7;
var Mode = 8;
var ContextConsumer = 9;
var ContextProvider = 10;
var ForwardRef = 11;
var Profiler = 12;
var SuspenseComponent = 13;
var MemoComponent = 14;
var SimpleMemoComponent = 15;
var LazyComponent = 16;
var IncompleteClassComponent = 17;
var DehydratedFragment = 18;
var SuspenseListComponent = 19;
var FundamentalComponent = 20;
var ScopeComponent = 21;
var Block = 22;
var OffscreenComponent = 23;
var LegacyHiddenComponent = 24;

function getNearestMountedFiber(fiber) {
  var node = fiber;
  var nearestMounted = fiber;

  if (!fiber.alternate) {
    var nextNode = node;
    do {
      node = nextNode;
      if ((node.flags & (Placement | Deletion)) !== NoFlags) {
        nearestMounted = node.return;
      }
      nextNode = node.return;
    } while (nextNode);
  } else {
    while (node.return) {
      node = node.return;
    }
  }

  if (node.tag === HostRoot) {
    return nearestMounted;
  }

  return null;
}

function getSuspenseInstanceFromFiber(fiber) {
  if (fiber.tag === SuspenseComponent) {
    var suspenseState = fiber.memoizedState;

    if (suspenseState === null) {
      var current = fiber.alternate;

      if (current !== null) {
        var currentState = current.memoizedState;

        if (currentState !== null) {
          var awakenedSpine = currentState.dehydrated;

          if (awakenedSpine !== null) {
            return getNextHydratableInstanceAfterSuspenseInstance(awakenedSpine);
          }
        }
      }
    }
  }

  return null;
}

function getClosestInstanceFromNode(targetNode) {
  var targetInst = targetNode[get(targetNode)];

  if (targetInst) {
    return targetInst;
  }

  var parentNode = targetNode.parentNode;

  while (parentNode) {
    targetInst = parentNode[get(parentNode)] || parentNode[get(targetNode)];

    if (targetInst) {
      var alternate = targetInst.alternate;

      if (targetInst.child !== null || alternate !== null && alternate.child !== null) {
        var suspenseInstance = getSuspenseInstanceFromFiber(targetInst);

        while (suspenseInstance !== null) {
          var targetSuspenseI = suspenseInstance[get(suspenseInstance)];

          if (targetSuspenseI) {
            return targetSuspenseI;
          }

          suspenseInstance = getNextHydratableInstanceAfterSuspenseInstance(suspenseInstance);
        }
      }

      return targetInst;
    }

    targetNode = parentNode;
    parentNode = targetNode.parentNode;
  }

  return null;
}

var flushSync = function (fn, a) {
  var prevExecutionContext = executionContext;

  if ((prevExecutionContext & (RenderContext | CommitContext)) !== NoContext) {
    return fn(a);
  }

  executionContext |= 1;

  try {
    if (fn) {
      return runWithPriority(DiscreteEventPriority, fn.bind(null, a));
    } else {
      return undefined;
    }
  } finally {
    executionContext = prevExecutionContext;

    if (executionContext === NoContext) {
      flushSyncCallbackQueue();
    }
  }
};

var version = "18.3.1";

export {
  IsThisRendererActing as __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  attemptSynchronousHydration as unstable_attemptSynchronousHydration,
  batchedUpdates as unstable_batchedUpdates,
  createRoot as unstable_createRoot,
  flushSync$1 as unstable_flushSync,
  createRoot,
  findDOMNode,
  flushSync,
  unbatchedUpdates,
  version
};

export default {
  createRoot
};