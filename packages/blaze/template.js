// [new] Blaze.Template([viewName], renderFunction)
//
// `Blaze.Template` is the base class of templates. `Template.Foo` in
// Meteor is a subclass of `Blaze.Template`.
//
// `viewName` is a string that looks like "Template.Foo" for templates
// defined by the compiler.

/**
 * @class
 * @summary Constructor for a Template, which is used to construct Views with particular name and content.
 * @locus Client
 * @param {String} [viewName] Optional.  A name for Views constructed by this Template.  See [`view.name`](#view_name).
 * @param {Function} renderFunction A function that returns [*renderable content*](#renderable_content).  This function is used as the `renderFunction` for Views constructed by this Template.
 */
// We are not using ES2016 class here because it does not allow instantiating the class
// without "new", which we want to support for backwards compatibility.
function Template(view) {
  // For backwards-compatibility to allow a new template class by doing "new Template(viewName, renderFunction)".
  if ((arguments.length === 2 && typeof arguments[0] === 'string' && typeof arguments[1] === 'function')
      || (arguments.length === 1 && typeof view === 'function')) {
    // If called as "new Template(viewName, renderFunction)".
    if (this instanceof Blaze.Template) {
      return this.constructor.newRenderFunction.apply(this.constructor, arguments);
    }
    // If called as "Template(viewName, renderFunction)", we assume the base template class.
    // This is for backwards compatibility anyway. One should be using "newRenderFunction" anyway.
    else {
      return Blaze.Template.newRenderFunction.apply(Blaze.Template, arguments);
    }
  }

  if (this instanceof Blaze.Template) {
    this._constructTemplate(view);
  }
  else {
    // If called as "Template(view)", we assume the base template class.
    // This is for backwards compatibility anyway. One should be using "new Template(view)" anyway.
    return new Blaze.Template(view);
  }
}

Blaze.Template = Template;

// We use another method to really construct the instance so that it is easier to monkey patch it.
Blaze.Template.prototype._constructTemplate = function (view) {
  if (!(this instanceof Blaze.Template))
    // called without `new`
    throw new Error("Trying to create a template instance without 'new'.");

  if (!(view instanceof Blaze.View))
    throw new Error("View required.");

  view._templateInstance = this;

  /**
   * @name view
   * @memberOf Blaze.Template
   * @instance
   * @summary The [View](#blaze_view) object for this invocation of the template.
   * @locus Client
   * @type {Blaze.View}
   */
  this.view = view;
  this.data = null;

  /**
   * @name firstNode
   * @memberOf Blaze.Template
   * @instance
   * @summary The first top-level DOM node in this template instance.
   * @locus Client
   * @type {DOMNode}
   */
  this.firstNode = null;

  /**
   * @name lastNode
   * @memberOf Blaze.Template
   * @instance
   * @summary The last top-level DOM node in this template instance.
   * @locus Client
   * @type {DOMNode}
   */
  this.lastNode = null;

  // This dependency is used to identify state transitions in
  // _subscriptionHandles which could cause the result of
  // Template#subscriptionsReady to change. Basically this is triggered
  // whenever a new subscription handle is added or when a subscription handle
  // is removed and they are not ready.
  this._allSubsReadyDep = new Tracker.Dependency();
  this._allSubsReady = false;

  this._subscriptionHandles = {};
};

Blaze.Template.newRenderFunction = function (viewName, renderFunction) {
  const parentTemplateClass = this;

  if (typeof viewName === 'function') {
    // omitted "viewName" argument
    renderFunction = viewName;
    viewName = '';
  }
  if (typeof viewName !== 'string')
    throw new Error("viewName must be a String (or omitted)");
  if (typeof renderFunction !== 'function')
    throw new Error("renderFunction must be a function");

  const templateClass = class extends parentTemplateClass {};

  if (Object.defineProperty) {
    // To be nicer for debugging than having "templateClass" everywhere.
    // TODO: Is there a way to provide class name dynamically?
    Object.defineProperty(templateClass, 'name', {
      value: viewName,
      configurable: true}
    );
  }

  templateClass.viewName = viewName;
  templateClass.renderFunction = renderFunction;

  templateClass.__helpers = new HelperMap;
  templateClass.__eventMaps = [];

  templateClass._callbacks = {
    created: [],
    rendered: [],
    destroyed: []
  };

  return templateClass;
};

const HelperMap = function () {};
HelperMap.prototype.get = function (name) {
  return this[' '+name];
};
HelperMap.prototype.set = function (name, helper) {
  this[' '+name] = helper;
};
HelperMap.prototype.has = function (name) {
  return (' '+name) in this;
};

/**
 * @summary Returns true if `value` is a template class like `Template.myTemplate`.
 * @locus Client
 * @param {Any} value The value to test.
 */
Blaze.isTemplate = function (t) {
  return (t && typeof t === 'function' && t.prototype instanceof Blaze.Template);
};

/**
 * @name  onCreated
 * @memberOf Blaze.Template
 * @summary Register a function to be called when an instance of this template is created.
 * @param {Function} callback A function to be added as a callback.
 * @locus Client
 * @importFromPackage templating
 */
Template.onCreated = function (cb) {
  this._callbacks.created.push(cb);
};

/**
 * @name  onRendered
 * @memberOf Blaze.Template
 * @summary Register a function to be called when an instance of this template is inserted into the DOM.
 * @param {Function} callback A function to be added as a callback.
 * @locus Client
 * @importFromPackage templating
 */
Template.onRendered = function (cb) {
  this._callbacks.rendered.push(cb);
};

/**
 * @name  onDestroyed
 * @memberOf Blaze.Template
 * @summary Register a function to be called when an instance of this template is removed from the DOM and destroyed.
 * @param {Function} callback A function to be added as a callback.
 * @locus Client
 * @importFromPackage templating
 */
Template.onDestroyed = function (cb) {
  this._callbacks.destroyed.push(cb);
};

Template._getCallbacks = function (which) {
  const templateClass = this;
  let callbacks = templateClass[which] ? [templateClass[which]] : [];
  // Fire all callbacks added with the new API (Template.onRendered())
  // as well as the old-style callback (e.g. Template.rendered) for
  // backwards-compatibility.
  callbacks = callbacks.concat(templateClass._callbacks[which]);
  return callbacks;
};

function fireCallbacks(callbacks, template) {
  Blaze.Template._withTemplateInstanceFunc(
    function () { return template; },
    function () {
      for (let i = 0, N = callbacks.length; i < N; i++) {
        callbacks[i].call(template);
      }
    });
}

Blaze.Template.constructView = function (contentFunc, elseFunc) {
  const templateClass = this;
  const view = Blaze.View(templateClass.viewName, templateClass.renderFunction);
  view.template = templateClass;

  view.templateContentBlock = (
    contentFunc ? templateClass.newRenderFunction('(contentBlock)', contentFunc) : null);
  view.templateElseBlock = (
    elseFunc ? templateClass.newRenderFunction('(elseBlock)', elseFunc) : null);

  if (templateClass.__eventMaps || typeof templateClass.events === 'object') {
    view._onViewRendered(function () {
      if (view.renderCount !== 1)
        return;

      if (! templateClass.__eventMaps.length && typeof templateClass.events === "object") {
        // Provide limited back-compat support for `.events = {...}`
        // syntax.  Pass `template.events` to the original `.events(...)`
        // function.  This code must run only once per template, in
        // order to not bind the handlers more than once, which is
        // ensured by the fact that we only do this when `__eventMaps`
        // is falsy, and we cause it to be set now.
        templateClass.prototype.events.call(templateClass, templateClass.events);
      }

      _.each(templateClass.__eventMaps, function (m) {
        Blaze._addEventMap(view, m, view);
      });
    });
  }

  view._templateInstance = new templateClass(view);
  view.templateInstance = function () {
    // Update data, firstNode, and lastNode, and return the Template instance
    // object.
    const inst = view._templateInstance;

    /**
     * @instance
     * @memberOf Blaze.Template
     * @name  data
     * @summary The data context of this instance's latest invocation.
     * @locus Client
     */
    inst.data = Blaze.getData(view);

    if (view._domrange && !view.isDestroyed) {
      inst.firstNode = view._domrange.firstNode();
      inst.lastNode = view._domrange.lastNode();
    } else {
      // on 'created' or 'destroyed' callbacks we don't have a DomRange
      inst.firstNode = null;
      inst.lastNode = null;
    }

    return inst;
  };

  /**
   * @name  created
   * @instance
   * @memberOf Blaze.Template
   * @summary Provide a callback when an instance of a template is created.
   * @locus Client
   * @deprecated in 1.1
   */
  // To avoid situations when new callbacks are added in between view
  // instantiation and event being fired, decide on all callbacks to fire
  // immediately and then fire them on the event.
  const createdCallbacks = templateClass._getCallbacks('created');
  view.onViewCreated(function () {
    fireCallbacks(createdCallbacks, view.templateInstance());
  });

  /**
   * @name  rendered
   * @instance
   * @memberOf Blaze.Template
   * @summary Provide a callback when an instance of a template is rendered.
   * @locus Client
   * @deprecated in 1.1
   */
  const renderedCallbacks = templateClass._getCallbacks('rendered');
  view.onViewReady(function () {
    fireCallbacks(renderedCallbacks, view.templateInstance());
  });

  /**
   * @name  destroyed
   * @instance
   * @memberOf Blaze.Template
   * @summary Provide a callback when an instance of a template is destroyed.
   * @locus Client
   * @deprecated in 1.1
   */
  const destroyedCallbacks = templateClass._getCallbacks('destroyed');
  view.onViewDestroyed(function () {
    fireCallbacks(destroyedCallbacks, view.templateInstance());
  });

  return view;
};

/**
 * @summary Find all elements matching `selector` in this template instance, and return them as a JQuery object.
 * @locus Client
 * @param {String} selector The CSS selector to match, scoped to the template contents.
 * @returns {DOMNode[]}
 */
Blaze.Template.prototype.$ = function (selector) {
  const view = this.view;
  if (! view._domrange)
    throw new Error("Can't use $ on template instance with no DOM");
  return view._domrange.$(selector);
};

/**
 * @summary Find all elements matching `selector` in this template instance.
 * @locus Client
 * @param {String} selector The CSS selector to match, scoped to the template contents.
 * @returns {DOMElement[]}
 */
Blaze.Template.prototype.findAll = function (selector) {
  return Array.prototype.slice.call(this.$(selector));
};

/**
 * @summary Find one element matching `selector` in this template instance.
 * @locus Client
 * @param {String} selector The CSS selector to match, scoped to the template contents.
 * @returns {DOMElement}
 */
Blaze.Template.prototype.find = function (selector) {
  const result = this.$(selector);
  return result[0] || null;
};

/**
 * @summary A version of [Tracker.autorun](#tracker_autorun) that is stopped when the template is destroyed.
 * @locus Client
 * @param {Function} runFunc The function to run. It receives one argument: a Tracker.Computation object.
 */
Blaze.Template.prototype.autorun = function (f) {
  return this.view.autorun(f);
};

/**
 * @summary A version of [Meteor.subscribe](#meteor_subscribe) that is stopped
 * when the template is destroyed.
 * @return {SubscriptionHandle} The subscription handle to the newly made
 * subscription. Call `handle.stop()` to manually stop the subscription, or
 * `handle.ready()` to find out if this particular subscription has loaded all
 * of its inital data.
 * @locus Client
 * @param {String} name Name of the subscription.  Matches the name of the
 * server's `publish()` call.
 * @param {Any} [arg1,arg2...] Optional arguments passed to publisher function
 * on server.
 * @param {Function|Object} [options] If a function is passed instead of an
 * object, it is interpreted as an `onReady` callback.
 * @param {Function} [options.onReady] Passed to [`Meteor.subscribe`](#meteor_subscribe).
 * @param {Function} [options.onStop] Passed to [`Meteor.subscribe`](#meteor_subscribe).
 * @param {DDP.Connection} [options.connection] The connection on which to make the
 * subscription.
 */
Blaze.Template.prototype.subscribe = function (/* arguments */) {
  const subHandles = this._subscriptionHandles;
  const args = _.toArray(arguments);

  // Duplicate logic from Meteor.subscribe
  let options = {};
  if (args.length) {
    const lastParam = _.last(args);

    // Match pattern to check if the last arg is an options argument
    const lastParamOptionsPattern = {
      onReady: Match.Optional(Function),
      // XXX COMPAT WITH 1.0.3.1 onError used to exist, but now we use
      // onStop with an error callback instead.
      onError: Match.Optional(Function),
      onStop: Match.Optional(Function),
      connection: Match.Optional(Match.Any)
    };

    if (_.isFunction(lastParam)) {
      options.onReady = args.pop();
    } else if (lastParam && ! _.isEmpty(lastParam) && Match.test(lastParam, lastParamOptionsPattern)) {
      options = args.pop();
    }
  }

  let subHandle;
  const oldStopped = options.onStop;
  options.onStop = (error) => {
    // When the subscription is stopped, remove it from the set of tracked
    // subscriptions to avoid this list growing without bound
    delete subHandles[subHandle.subscriptionId];

    // Removing a subscription can only change the result of subscriptionsReady
    // if we are not ready (that subscription could be the one blocking us being
    // ready).
    if (! this._allSubsReady) {
      this._allSubsReadyDep.changed();
    }

    if (oldStopped) {
      oldStopped(error);
    }
  };

  const connection = options.connection;
  const callbacks = _.pick(options, ["onReady", "onError", "onStop"]);

  // The callbacks are passed as the last item in the arguments array passed to
  // View#subscribe
  args.push(callbacks);

  // View#subscribe takes the connection as one of the options in the last
  // argument
  subHandle = this.view.subscribe.call(this.view, args, {
    connection: connection
  });

  if (! _.has(subHandles, subHandle.subscriptionId)) {
    subHandles[subHandle.subscriptionId] = subHandle;

    // Adding a new subscription will always cause us to transition from ready
    // to not ready, but if we are already not ready then this can't make us
    // ready.
    if (this._allSubsReady) {
      this._allSubsReadyDep.changed();
    }
  }

  return subHandle;
};

/**
 * @summary A reactive function that returns true when all of the subscriptions
 * called with [this.subscribe](#Template-subscribe) are ready.
 * @return {Boolean} True if all subscriptions on this template instance are
 * ready.
 */
Blaze.Template.prototype.subscriptionsReady = function () {
  this._allSubsReadyDep.depend();

  this._allSubsReady = _.all(this._subscriptionHandles, function (handle) {
    return handle.ready();
  });

  return this._allSubsReady;
};

/**
 * @summary Specify template helpers available to this template.
 * @locus Client
 * @param {Object} helpers Dictionary of helper functions by name.
 * @importFromPackage templating
 */
Blaze.Template.helpers = function (dict) {
  const templateClass = this;

  if (! _.isObject(dict)) {
    throw new Error("Helpers dictionary has to be an object");
  }

  for (let k in dict)
    templateClass.__helpers.set(k, dict[k]);
};

// Kind of like Blaze.currentView but for the template instance.
// This is a function, not a value -- so that not all helpers
// are implicitly dependent on the current template instance's `data` property,
// which would make them dependenct on the data context of the template
// inclusion.
Blaze.Template._currentTemplateInstanceFunc = null;

Blaze.Template._withTemplateInstanceFunc = function (templateInstanceFunc, func) {
  if (typeof func !== 'function')
    throw new Error("Expected function, got: " + func);

  const oldTmplInstanceFunc = Template._currentTemplateInstanceFunc;
  try {
    Blaze.Template._currentTemplateInstanceFunc = templateInstanceFunc;
    return func();
  } finally {
    Blaze.Template._currentTemplateInstanceFunc = oldTmplInstanceFunc;
  }
};

/**
 * @summary Specify event handlers for this template.
 * @locus Client
 * @param {EventMap} eventMap Event handlers to associate with this template.
 * @importFromPackage templating
 */
Blaze.Template.events = function (eventMap) {
  const templateClass = this;

  if (! _.isObject(eventMap)) {
    throw new Error("Event map has to be an object");
  }

  const eventMap2 = {};
  for (let k in eventMap) {
    eventMap2[k] = (function (k, v) {
      return function (event/*, ...*/) {
        let view = this; // passed by EventAugmenter
        let data = Blaze.getData(event.currentTarget);
        if (data == null)
          data = {};
        let args = Array.prototype.slice.call(arguments);
        let tmplInstanceFunc = Blaze._bind(view.templateInstance, view);
        args.splice(1, 0, tmplInstanceFunc());

        return Blaze.Template._withTemplateInstanceFunc(tmplInstanceFunc, function () {
          return v.apply(data, args);
        });
      };
    })(k, eventMap[k]);
  }

  templateClass.__eventMaps.push(eventMap2);
};

/**
 * @function
 * @name instance
 * @memberOf Template
 * @summary The [template instance](#template_inst) corresponding to the current template helper, event handler, callback, or autorun.  If there isn't one, `null`.
 * @locus Client
 * @returns {Blaze.Template}
 * @importFromPackage templating
 */
Blaze.Template.instance = function () {
  return Blaze.Template._currentTemplateInstanceFunc
    && Blaze.Template._currentTemplateInstanceFunc();
};

// Note: Template.currentData() is documented to take zero arguments,
// while Blaze.getData takes up to one.

/**
 * @summary
 *
 * - Inside an `onCreated`, `onRendered`, or `onDestroyed` callback, returns
 * the data context of the template.
 * - Inside an event handler, returns the data context of the template on which
 * this event handler was defined.
 * - Inside a helper, returns the data context of the DOM node where the helper
 * was used.
 *
 * Establishes a reactive dependency on the result.
 * @locus Client
 * @function
 * @importFromPackage templating
 */
Blaze.Template.currentData = Blaze.getData;

/**
 * @summary Accesses other data contexts that enclose the current data context.
 * @locus Client
 * @function
 * @param {Integer} [numLevels] The number of levels beyond the current data context to look. Defaults to 1.
 * @importFromPackage templating
 */
Blaze.Template.parentData = Blaze._parentData;

/**
 * @summary Defines a [helper function](#template_helpers) which can be used from all templates.
 * @locus Client
 * @function
 * @param {String} name The name of the helper function you are defining.
 * @param {Function} function The helper function itself.
 * @importFromPackage templating
 */
Blaze.Template.registerHelper = Blaze.registerHelper;

/**
 * @summary Removes a global [helper function](#template_helpers).
 * @locus Client
 * @function
 * @param {String} name The name of the helper function you are defining.
 * @importFromPackage templating
 */
Blaze.Template.deregisterHelper = Blaze.deregisterHelper;
