(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.tpFSM = factory());
})(this, (function () { 'use strict';

    // ISC License (ISC)
    // Copyright 2021 Jean-Jacques Dubray

    // Permission to use, copy, modify, and/or distribute this software for any purpose
    // with or without fee is hereby granted, provided that the above copyright notice
    // and this permission notice appear in all copies.

    // THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    // REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
    // FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT,
    // OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA
    // OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
    // ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

    function checkAction(actions, action) {
      const actionLabels = keys(actions);
      return actionLabels.includes(action);
    }
    const pushAction = (s, a) => {
      s.push(a);
      return s;
    };
    const first = arr => arr ? arr[0] : undefined;
    const keys = function () {
      let o = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
      return Object.keys(o);
    };
    const assign = function (a) {
      let b = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      return Object.assign(a, b);
    };
    const isFunction = v => typeof v === 'function';
    const stateForAction = (actions, action) => first(actions[action]);
    const actionsAndStatesFor = transitions => ({
      pc0: first(transitions).from,
      states: transitions.reduce((s, t) => assign(s, {
        [t.from]: {
          transitions: s[t.from] && s[t.from].transitions && first(s[t.from].transitions) ? pushAction(s[t.from].transitions, t.on) : [t.on]
        },
        [t.to]: s[t.to] && first(s[t.to].transitions) ? s[t.to] : {
          transitions: t.to === t.from ? [t.on] : []
        }
      }), {}),
      actions: transitions.reduce((a, t) => assign(a, {
        [t.on]: [t.to]
      }), {}),
      deterministic: true,
      enforceAllowedTransitions: true
    });
    const flattenTransitions = transitions => keys(transitions).reduce((ft, t) => {
      const state = transitions[t];
      const actions = keys(state);
      return ft.concat(actions.map(a => ({
        from: t,
        to: state[a],
        on: a
      })));
    }, []);
    function addAction(actions, id) {
      return function (intent, action) {
        if (checkAction(actions, action) && intent != null) {
          const wrapped = async function () {
            const proposal = (await intent.apply(this, arguments)) || {};
            proposal.__actionName = action;
            proposal.__stateMachineId = id;
            return proposal;
          };
          wrapped.__actionName = action;
          wrapped.__stateMachineId = id;
          return wrapped;
        }
        throw new Error(`addAction invalid action: ${action}`);
      };
    }
    const modelGetValue = function (model, componentName) {
      let key = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'pc';
      return componentName ? isFunction(model.localState) ? model.localState(componentName)[key] : model.__components ? model.__components[componentName][key] : undefined : model[key];
    };
    const modelSetValue = (model, componentName, key, value) => {
      if (componentName) {
        if (isFunction(model.localState)) {
          model.localState(componentName)[key] = value;
        } else {
          model.__components = model.__components || {};
          model.__components[componentName] = model.__components[componentName] || {};
          model.__components[componentName][key] = value;
        }
      } else {
        model[key] = value;
      }
      return value;
    };
    function stateMachineReactor(_ref) {
      let actions = _ref.actions,
        transitions = _ref.transitions,
        states = _ref.states,
        composite = _ref.composite,
        _ref$pc = _ref.pc,
        pc = _ref$pc === void 0 ? 'pc' : _ref$pc,
        id = _ref.id,
        componentName = _ref.componentName,
        _ref$lax = _ref.lax,
        lax = _ref$lax === void 0 ? true : _ref$lax,
        _ref$blockUnexpectedA = _ref.blockUnexpectedActions,
        blockUnexpectedActions = _ref$blockUnexpectedA === void 0 ? false : _ref$blockUnexpectedA;
      const specification = getStatesFrom(states, transitions);
      const stateLabels = keys(specification.states);
      const smr = [model => () => {
        const previousState = modelGetValue(model, componentName, `${pc}_1`);
        const currentState = modelGetValue(model, componentName, pc);
        const actionName = model.__actionName;
        const stateMachineId = model.__stateMachineIdForLastAction;
        if (!lax && !stateLabels.includes(currentState)) {
          model.__error = `unexpected state: ${currentState}`;
        } else {
          try {
            if (actionName && previousState && !specification.states[previousState].transitions.includes(actionName)) {
              if (stateMachineId === id) {
                model.__error = `unexpected action ${actionName} for state: ${previousState}`;
              }
            }
          } catch (e) {
            model.__error = `unexpected error: ${e.message} for action ${actionName} and state: ${currentState}`;
          }
        }
      }];
      if (blockUnexpectedActions) {
        smr.push(model => () => {
          var _model$__allowedActio;
          const currentState = modelGetValue(model, componentName, pc);
          const _specification$states = specification.states[currentState],
            _specification$states2 = _specification$states.transitions,
            transitions = _specification$states2 === void 0 ? [] : _specification$states2,
            _specification$states3 = _specification$states.guards,
            guards = _specification$states3 === void 0 ? [] : _specification$states3;
          model.__blockUnexpectedActions = true;
          model.__allowedActions = ((_model$__allowedActio = model.__allowedActions) !== null && _model$__allowedActio !== void 0 ? _model$__allowedActio : []).concat(transitions.filter(t => guards.reduce((f, g) => g.action === '*' || (g.action || first(transitions)) === t ? f && g.condition(model) : f, true)));
          if (model.allowedActions().length === 0) {
            model.__allowedActions = ['__EMPTY'];
          }
        });
      }
      if (composite) {
        smr.push(model => () => {
          var _composite$onState;
          const currentParentState = modelGetValue(model, composite.onState.component, composite.onState.pc);
          if (currentParentState !== ((_composite$onState = composite.onState) === null || _composite$onState === void 0 ? void 0 : _composite$onState.label)) {
            var _model$__disallowedAc;
            model.__disallowedActions = (_model$__disallowedAc = model.__disallowedActions) !== null && _model$__disallowedAc !== void 0 ? _model$__disallowedAc : [].concat(keys(actions));
          }
        });
      }
      return smr;
    }
    function getStatesFrom(states, transitions) {
      if (!states) {
        let specification;
        switch (typeof transitions) {
          case 'object':
            specification = actionsAndStatesFor(flattenTransitions(transitions));
            break;
          default:
            specification = actionsAndStatesFor(transitions);
        }
        return specification;
      } else {
        return {
          states
        };
      }
    }
    const actionsFor = (actions, transitions) => actions ? actions : actionsAndStatesFor(transitions).actions;
    const step = function () {
      let step = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      let value = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'other';
      return `${step}. ${value}`;
    };
    const updateRuntime = function (stateMachine, currentState, previousState) {
      let action = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 'other';
      stateMachine.step = 1 + (stateMachine.step || 0);
      const actionLabel = step(stateMachine.step, action);
      if (!stateMachine.states[currentState]) {
        stateMachine.states[currentState] = {
          transitions: []
        };
      }
      const a = stateMachine.actions[actionLabel];
      if (a == null) {
        stateMachine.actions[actionLabel] = [currentState];
      } else {
        a.indexOf(currentState) === -1 && a.push(currentState);
      }
      if (previousState) {
        const p = stateMachine.states[previousState];
        if (p != null) {
          p.transitions.indexOf(actionLabel) === -1 && p.transitions.push(actionLabel);
        }
      }
    };
    function stateMachineAcceptors(_ref2) {
      let actions = _ref2.actions,
        states = _ref2.states,
        composite = _ref2.composite,
        transitions = _ref2.transitions,
        pc = _ref2.pc,
        id = _ref2.id,
        componentName = _ref2.componentName,
        deterministic = _ref2.deterministic,
        enforceAllowedTransitions = _ref2.enforceAllowedTransitions,
        rejectUnexpectedActions = _ref2.rejectUnexpectedActions,
        stateDiagram = _ref2.stateDiagram;
      const specification = getStatesFrom(states, transitions);
      const stateLabels = keys(specification.states);
      actions = actions || specification.actions;
      // v2 (sam-fsm#4): on a sam-pattern v2 instance, an invalid transition is an
      // observable rejection (lastStep().classification === 'rejected') instead of
      // an __error; falls back to the __error slot on v1 instances
      const flagUnexpected = (model, stepApi, message) => {
        if (rejectUnexpectedActions && stepApi && isFunction(stepApi.reject)) {
          stepApi.reject(message);
        } else {
          model.__error = message;
        }
      };
      // v2.1 (sam-pattern #25): on a next-state instance (strict + modelShape) the
      // acceptor's model is a frozen pre-state and writes go to the stepApi.next
      // draft; on v1/default instances stepApi.next is absent and writes stay
      // in place. Reads always come from `model` (the pre-state).
      const writeTarget = (model, stepApi) => stepApi && stepApi.next ? stepApi.next : model;
      // the fsm speaks for its own variables: on any step where it does not
      // assign pc/pc_1 (foreign machine's action, invalid transition kept in the
      // __error slot) it declares them unchanged so the #25 frame check holds.
      // Component-scoped machines write component-local state, which lives
      // outside the instance modelShape — no framing there.
      const frameOwnVars = stepApi => {
        if (!componentName && stepApi && isFunction(stepApi.unchanged)) {
          stepApi.unchanged(pc, `${pc}_1`);
        }
      };
      const acceptors = deterministic ? [model => (proposal, stepApi) => {
        if (!proposal.__stateMachineId || proposal.__stateMachineId === id) {
          const currentState = modelGetValue(model, componentName, pc);
          if (!enforceAllowedTransitions || enforceAllowedTransitions && specification.states[currentState].transitions.includes(proposal.__actionName)) {
            // capture the target state: with a draft, `model` still
            // holds the pre-state after the write (#25)
            const nextState = stateForAction(actions, proposal.__actionName);
            const target = writeTarget(model, stepApi);
            modelSetValue(target, componentName, `${pc}_1`, currentState);
            modelSetValue(target, componentName, pc, nextState);
            updateRuntime(stateDiagram, nextState, currentState, proposal.__actionName);
          } else {
            if (composite) {
              var _composite$onState2, _composite$onState3, _composite$onState4;
              const actionFromComposite = keys(actionsFor(actions, transitions)).map(action => action === proposal.__actionName).reduce((acc, v) => v || acc, false);
              if (actionFromComposite && modelGetValue(model, (_composite$onState2 = composite.onState) === null || _composite$onState2 === void 0 ? void 0 : _composite$onState2.component, (_composite$onState3 = composite.onState) === null || _composite$onState3 === void 0 ? void 0 : _composite$onState3.pc) === ((_composite$onState4 = composite.onState) === null || _composite$onState4 === void 0 ? void 0 : _composite$onState4.label)) {
                flagUnexpected(model, stepApi, `unexpected action ${proposal.__actionName} for state: ${currentState}`);
              }
            } else {
              flagUnexpected(model, stepApi, `unexpected action ${proposal.__actionName} for state: ${currentState}`);
            }
            frameOwnVars(stepApi);
          }
        } else {
          // another machine's action: this machine's state is unchanged
          frameOwnVars(stepApi);
        }
      }] : stateLabels.map(label => specification.states[label].acceptor);
      acceptors.unshift(model => proposal => {
        model.__actionName = proposal.__actionName;
        model.__stateMachineIdForLastAction = proposal.__stateMachineId;
      }, model => proposal => {
        if (model.__lastAllowedActionsReset !== proposal) {
          model.__allowedActions = [];
          model.__disallowedActions = [];
          model.__lastAllowedActionsReset = proposal;
        }
      });
      return acceptors;
    }
    function stateMachineNaps(_ref3) {
      let states = _ref3.states,
        composite = _ref3.composite,
        transitions = _ref3.transitions,
        pc = _ref3.pc,
        componentName = _ref3.componentName;
      const specification = getStatesFrom(states, transitions);
      const stateLabels = keys(specification.states);
      const fsmNaps = stateLabels.map(state => {
        var _specification$states4, _specification$states5;
        return (_specification$states4 = (_specification$states5 = specification.states[state]) === null || _specification$states5 === void 0 || (_specification$states5 = _specification$states5.naps) === null || _specification$states5 === void 0 ? void 0 : _specification$states5.map(nap => ({
          state,
          condition: nap.condition,
          nextAction: nap.nextAction
        }))) !== null && _specification$states4 !== void 0 ? _specification$states4 : [];
      }).flat().map(predicate => state => () => {
        if (modelGetValue(state, componentName, pc) === predicate.state && predicate.condition(state)) {
          predicate.nextAction(state);
          return true;
        }
      });
      if (composite) {
        return fsmNaps.concat(composite.transitions.map(t => state => () => {
          if (modelGetValue(state, componentName, pc) === t.onState) {
            t.action(t.proposal.reduce((o, key) => assign(o, {
              [key]: state[key]
            }), {}));
            return true;
          }
        }));
      }
      return fsmNaps;
    }
    const gvt = function (start, end) {
      let action = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : '';
      let condition = arguments.length > 3 ? arguments[3] : undefined;
      return `${start} -> ${end} [label = "${action}${condition ? `\\n${condition}` : ''}"];`;
    };
    function renderGraphViz(_ref4) {
      let pc0 = _ref4.pc0,
        actions = _ref4.actions,
        states = _ref4.states,
        transitions = _ref4.transitions;
        _ref4.deterministic;
      const specification = getStatesFrom(states, transitions);
      actions = actions || specification.actions;
      let pcEnd;
      const graphVizTransitions = keys(states).map(state => {
        var _states$state, _states$state2;
        pcEnd = pcEnd == null && (((_states$state = states[state]) === null || _states$state === void 0 ? void 0 : _states$state.transitions) == null || first(states[state].transitions) == null) ? state : undefined;
        return (_states$state2 = states[state]) === null || _states$state2 === void 0 || (_states$state2 = _states$state2.transitions) === null || _states$state2 === void 0 ? void 0 : _states$state2.map(transition => {
          var _states$state3;
          const condition = (_states$state3 = states[state]) === null || _states$state3 === void 0 || (_states$state3 = _states$state3.guards) === null || _states$state3 === void 0 ? void 0 : _states$state3.reduce((a, c) => {
            if (c.action !== transition) return a;
            const parts = c.condition.toString().split('return');
            return parts.length > 1 ? first(parts[1]).split(';') : [c.condition.toString()];
          }, undefined);
          return gvt(state, first(actions[transition]), transition, condition);
        }).join('\n');
      }).join('\n');
      const output = `
digraph fsm_diagram {
rankdir=LR;
size="8,5"
${pc0} [shape = circle margin=0 fixedsize=true width=0.33 fontcolor=black style=filled color=black label="\\n\\n\\n${pc0}"]
${pcEnd ? `${pcEnd} [shape = doublecircle margin=0 style=filled fontcolor=white color=black]` : '\n'}
node [shape = Mrecord];
${graphVizTransitions}
}
    `;
      return output;
    }
    function runTimeStateDiagram(pc0, stateDiagram, deterministic) {
      stateDiagram.actions = {};
      stateDiagram.states = {
        [pc0]: {
          transitions: []
        }
      };
      stateDiagram.step = 0;
      return () => renderGraphViz({
        pc0,
        actions: stateDiagram.actions,
        states: stateDiagram.states,
        deterministic
      });
    }
    function fsm(_ref5) {
      let componentName = _ref5.componentName,
        pc0 = _ref5.pc0,
        actions = _ref5.actions,
        transitions = _ref5.transitions,
        states = _ref5.states,
        composite = _ref5.composite,
        _ref5$pc = _ref5.pc,
        pc = _ref5$pc === void 0 ? 'pc' : _ref5$pc,
        _ref5$deterministic = _ref5.deterministic,
        deterministic = _ref5$deterministic === void 0 ? false : _ref5$deterministic,
        _ref5$lax = _ref5.lax,
        lax = _ref5$lax === void 0 ? true : _ref5$lax,
        _ref5$enforceAllowedT = _ref5.enforceAllowedTransitions,
        enforceAllowedTransitions = _ref5$enforceAllowedT === void 0 ? false : _ref5$enforceAllowedT,
        _ref5$blockUnexpected = _ref5.blockUnexpectedActions,
        blockUnexpectedActions = _ref5$blockUnexpected === void 0 ? false : _ref5$blockUnexpected,
        _ref5$rejectUnexpecte = _ref5.rejectUnexpectedActions,
        rejectUnexpectedActions = _ref5$rejectUnexpecte === void 0 ? false : _ref5$rejectUnexpecte,
        _ref5$schemas = _ref5.schemas,
        schemas = _ref5$schemas === void 0 ? {} : _ref5$schemas,
        _ref5$domains = _ref5.domains,
        domains = _ref5$domains === void 0 ? {} : _ref5$domains,
        _ref5$stateDiagram = _ref5.stateDiagram,
        stateDiagram = _ref5$stateDiagram === void 0 ? {} : _ref5$stateDiagram,
        _ref5$id = _ref5.id,
        id = _ref5$id === void 0 ? Date.now() + Math.floor(Math.random() * 100000000) : _ref5$id;
      const stampProposal = proposal => {
        proposal.__stateMachineId = id;
        return proposal;
      };
      return {
        id,
        initialState: model => {
          modelSetValue(model, componentName, pc, pc0);
          model.__actionName = undefined;
          return model;
        },
        addAction: addAction(actions, id),
        // v2 (sam-fsm#1): the fsm's own state, declared — spread into a strict
        // sam-pattern v2 component (pc_1 is previous-state bookkeeping: internal)
        modelShape: {
          [pc]: {
            type: 'string'
          },
          [`${pc}_1`]: {
            type: 'string',
            nullable: true,
            internal: true
          }
        },
        // v2 (sam-fsm#2/#3): the FSM alphabet as a sam-pattern v2 named-intent
        // map. Each entry may be customized with a proposal creator (function or
        // { action, schema, domain }); defaults are an empty-payload creator, a
        // permissive schema, and the [[]] no-argument domain — so a bare
        // event-driven fsm passes validate() and is checker-explorable with
        // zero configuration.
        namedActions: function () {
          let creators = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
          return keys(actionsFor(actions, transitions)).reduce((named, name) => {
            var _ref6, _ref7, _ref8, _ref9, _ref0;
            const definition = creators[name];
            const creator = (_ref6 = isFunction(definition) ? definition : definition === null || definition === void 0 ? void 0 : definition.action) !== null && _ref6 !== void 0 ? _ref6 : () => ({});
            const wrapped = function () {
              const result = creator.apply(this, arguments);
              return result && isFunction(result.then) ? result.then(proposal => stampProposal(proposal || {})) : stampProposal(result || {});
            };
            named[name] = {
              action: wrapped,
              schema: (_ref7 = (_ref8 = isFunction(definition) ? undefined : definition === null || definition === void 0 ? void 0 : definition.schema) !== null && _ref8 !== void 0 ? _ref8 : schemas[name]) !== null && _ref7 !== void 0 ? _ref7 : {},
              domain: (_ref9 = (_ref0 = isFunction(definition) ? undefined : definition === null || definition === void 0 ? void 0 : definition.domain) !== null && _ref0 !== void 0 ? _ref0 : domains[name]) !== null && _ref9 !== void 0 ? _ref9 : [[]]
            };
            return named;
          }, {});
        },
        stateMachine: stateMachineReactor({
          id,
          componentName,
          actions,
          states,
          composite,
          transitions,
          pc,
          lax,
          blockUnexpectedActions}),
        acceptors: stateMachineAcceptors({
          id,
          componentName,
          actions,
          states,
          composite,
          transitions,
          pc,
          deterministic,
          enforceAllowedTransitions,
          rejectUnexpectedActions,
          stateDiagram
        }),
        naps: stateMachineNaps({
          states,
          componentName,
          composite,
          pc
        }),
        event: eventName => {
          const action = () => ({
            __actionName: eventName,
            __stateMachineId: id
          });
          action.__actionName = eventName;
          action.__stateMachineId = id;
          return action;
        },
        stateDiagram: renderGraphViz({
          pc0,
          actions,
          transitions,
          states,
          deterministic
        }),
        runtimeStateDiagram: runTimeStateDiagram(pc0, stateDiagram, deterministic)
      };
    }
    fsm.flattenTransitions = flattenTransitions;
    fsm.actionsAndStatesFor = actionsAndStatesFor;

    // ISC License (ISC)
    // Copyright 2019 Jean-Jacques Dubray

    var index = {
      fsm
    };

    return index;

}));
