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
    const actionLabels = keys(actions)
    return actionLabels.includes(action)
}

const pushAction = (s, a) => {
    s.push(a)
    return s
}

const first = arr => arr ? arr[0] : undefined
const E = val => val !== undefined
const A = (arr = []) => arr
const keys = (o = {}) => Object.keys(o)
const assign = (a, b = {}) => Object.assign(a, b)
const isFunction = v => typeof v === 'function'

const stateForAction = (actions, action) => first(actions[action])

const actionsAndStatesFor = (transitions) => ({
    pc0: first(transitions).from,
    states: transitions.reduce( 
        (s, t) => assign(s, { 
            [t.from]: { 
                transitions: s[t.from] && s[t.from].transitions && first(s[t.from].transitions)  
                    ? pushAction(s[t.from].transitions, t.on) 
                    : [t.on] 
            }, 
            [t.to]: s[t.to] && first(s[t.to].transitions)  
                ? s[t.to] 
                : { transitions: t.to === t.from ? [t.on] : [] }
        }), 
        {}
    ),
    actions: transitions.reduce( 
            (a, t) => assign(a, { [t.on]: [t.to] }
        ), 
        {}
    ),
    deterministic: true,
    enforceAllowedTransitions: true
})

const flattenTransitions = (transitions) => keys(transitions).reduce(
    (ft, t) => {
        const state = transitions[t]
        const actions = keys(state)
        return ft.concat(actions.map(a => ({ from: t, to: state[a], on: a })))
    }, 
    []
)

function addAction(actions, id) {
    return function(intent, action) {
        if (checkAction(actions, action) && intent != null) {
            const wrapped = async function() {
                const proposal = (await intent.apply(this, arguments)) || {}
                proposal.__actionName = action
                proposal.__stateMachineId = id
                return proposal
            }
                
            wrapped.__actionName = action
            wrapped.__stateMachineId = id
            return wrapped
        }
        throw new Error(`addAction invalid action: ${action}`)
    }
}

const modelGetValue = (model, componentName, key  = 'pc') => 
    componentName 
        ? isFunction(model.localState)
            ? model.localState(componentName)[key]
            : model.__components 
                ? model.__components[componentName][key]
                : undefined
        : model[key]

const modelSetValue = (model, componentName, key, value) => {
    if (componentName) {
        if (isFunction(model.localState)) {
            model.localState(componentName)[key] = value;
        } else {
            model.__components = model.__components || {}
            model.__components[componentName] = model.__components[componentName] || {}
            model.__components[componentName][key] = value
        }
    } else {
        model[key] = value
    }
    return value
}

function stateMachineReactor({ pc0, actions, transitions, states, composite, pc = 'pc', id, componentName, deterministic = false, lax = true, enforceAllowedTransitions = false, blockUnexpectedActions = false }) {
    const specification = getStatesFrom(states, transitions)
    const stateLabels = keys(specification.states)
    const smr = [
        model => () => {
            const previousState = modelGetValue( model, componentName, `${pc}_1`)
            const currentState = modelGetValue(model, componentName, pc)
            const actionName = model.__actionName
            const stateMachineId = model.__stateMachineIdForLastAction
            if (!lax && !stateLabels.includes(currentState)) {
                model.__error = `unexpected state: ${currentState}`
            } else {
                try {
                    if (actionName && previousState && !specification.states[previousState].transitions.includes(actionName)) {
                        if (stateMachineId === id) {
                            model.__error = `unexpected action ${actionName} for state: ${previousState}`
                        }
                    }
                } catch(e) {
                    model.__error = `unexpected error: ${e.message} for action ${actionName} and state: ${currentState}`
                } 
            }
        }
    ]
    if (blockUnexpectedActions) {
        smr.push( model => () => {
            const currentState = modelGetValue(model, componentName, pc)
            const { transitions = [], guards = [] } = specification.states[currentState]
            model.__blockUnexpectedActions = true
            model.__allowedActions = (model.__allowedActions ?? [])
                .concat(transitions
                    .filter(t => guards.reduce(
                        (f, g) => (g.action === '*' || (g.action || first(transitions)) === t)
                                    ? f && g.condition(model)
                                    : f,
                        true)
                    )
                )
            if (model.allowedActions().length === 0) {
                model.__allowedActions = ['__EMPTY']
            }
        })
    }
    if (composite) {
        smr.push( model => () => {
            const currentParentState = modelGetValue(model, composite.onState.component, composite.onState.pc)
            if (currentParentState !== composite.onState?.label) {
                model.__disallowedActions = model.__disallowedActions ?? []
                    .concat(keys(actions))
            }
        })
    }
    return smr
}

function getStatesFrom(states, transitions) {
    if (!states) {
        let specification
        switch (typeof transitions) {
            case 'object':
                specification = actionsAndStatesFor(flattenTransitions(transitions))
                break
            default:
                specification = actionsAndStatesFor(transitions)
        }
        return specification
    } else {
        return { states }
    }
}

const actionsFor = (actions, transitions) => actions ? actions : actionsAndStatesFor(transitions).actions

const step = (step = 0, value = 'other') => `${step}. ${value}`

const updateRuntime = (stateMachine, currentState, previousState, action = 'other') => {
    stateMachine.step = 1 + (stateMachine.step || 0)
    const actionLabel = step(stateMachine.step, action)
    if (!stateMachine.states[currentState]) {
        stateMachine.states[currentState] = {
            transitions: []
        }
    }
    const a = stateMachine.actions[actionLabel]
    if (a == null) {
        stateMachine.actions[actionLabel] = [currentState]
    } else {
        a.indexOf(currentState) === -1
        && a.push(currentState)
    }
    if (previousState) {
        const p = stateMachine.states[previousState]
        if (p != null) {
            p.transitions.indexOf(actionLabel) === -1
            && p.transitions.push(actionLabel)
        } 
    }
}

function stateMachineAcceptors({ pc0, actions, states, composite, transitions, pc, id, componentName, deterministic, lax, enforceAllowedTransitions, rejectUnexpectedActions, stateDiagram }) {
    const specification = getStatesFrom(states, transitions)
    const stateLabels = keys(specification.states)
    actions = actions || specification.actions
    // v2 (sam-fsm#4): on a sam-pattern v2 instance, an invalid transition is an
    // observable rejection (lastStep().classification === 'rejected') instead of
    // an __error; falls back to the __error slot on v1 instances
    const flagUnexpected = (model, stepApi, message) => {
        if (rejectUnexpectedActions && stepApi && isFunction(stepApi.reject)) {
            stepApi.reject(message)
        } else {
            model.__error = message
        }
    }
    // v2.1 (sam-pattern #25): on a next-state instance (strict + modelShape) the
    // acceptor's model is a frozen pre-state and writes go to the stepApi.next
    // draft; on v1/default instances stepApi.next is absent and writes stay
    // in place. Reads always come from `model` (the pre-state).
    const writeTarget = (model, stepApi) => (stepApi && stepApi.next ? stepApi.next : model)
    // the fsm speaks for its own variables: on any step where it does not
    // assign pc/pc_1 (foreign machine's action, invalid transition kept in the
    // __error slot) it declares them unchanged so the #25 frame check holds.
    // Component-scoped machines write component-local state, which lives
    // outside the instance modelShape — no framing there.
    const frameOwnVars = (stepApi) => {
        if (!componentName && stepApi && isFunction(stepApi.unchanged)) {
            stepApi.unchanged(pc, `${pc}_1`)
        }
    }
    const acceptors = deterministic
        ? [model => (proposal, stepApi) => {
            if (!proposal.__stateMachineId || proposal.__stateMachineId === id) {
                const currentState = modelGetValue(model, componentName, pc)
                if (!enforceAllowedTransitions
                    || (
                        enforceAllowedTransitions
                        && specification.states[currentState].transitions.includes(proposal.__actionName)
                    )
                ) {
                    // capture the target state: with a draft, `model` still
                    // holds the pre-state after the write (#25)
                    const nextState = stateForAction(actions, proposal.__actionName)
                    const target = writeTarget(model, stepApi)
                    modelSetValue(target, componentName, `${pc}_1`, currentState)
                    modelSetValue(target, componentName, pc, nextState)
                    updateRuntime(stateDiagram, nextState, currentState, proposal.__actionName)
                } else {
                    if (composite) {
                        const actionFromComposite = keys(actionsFor(actions, transitions)).map(action => action === proposal.__actionName).reduce((acc, v) => v || acc, false)
                        if (actionFromComposite && modelGetValue(model, composite.onState?.component, composite.onState?.pc) === composite.onState?.label) {
                            flagUnexpected(model, stepApi, `unexpected action ${proposal.__actionName} for state: ${currentState}`)
                        }
                    } else {
                        flagUnexpected(model, stepApi, `unexpected action ${proposal.__actionName} for state: ${currentState}`)
                    }
                    frameOwnVars(stepApi)
                }
            } else {
                // another machine's action: this machine's state is unchanged
                frameOwnVars(stepApi)
            }
        }]
        : stateLabels.map(label => specification.states[label].acceptor)
    acceptors.unshift( 
        model => proposal => { 
            model.__actionName = proposal.__actionName 
            model.__stateMachineIdForLastAction = proposal.__stateMachineId
        }, 
        model => proposal => {
            if (model.__lastAllowedActionsReset !== proposal) {
                model.__allowedActions = []
                model.__disallowedActions = []
                model.__lastAllowedActionsReset = proposal
            }
        }
    )
    return acceptors
}        

function stateMachineNaps({ states, composite, transitions, pc, componentName }) {
    const specification = getStatesFrom(states, transitions)
    const stateLabels = keys(specification.states)
    const fsmNaps = stateLabels
                .map(state => specification.states[state]?.naps?.map(nap => ({ state, condition: nap.condition, nextAction: nap.nextAction })) ?? [])
                .flat()
                .map(predicate => state => () => {
                    if (modelGetValue(state, componentName, pc) === predicate.state && predicate.condition(state)) {
                        predicate.nextAction(state)
                        return true
                    }
                })
    if (composite) {
        return fsmNaps.concat(composite.transitions.map( t => (state) => () => {
            if (modelGetValue(state, componentName, pc) === t.onState) {
                t.action(t.proposal.reduce((o, key) => assign(o, {
                            [key]: state[key]
                        }
                    ), {})
                )
                return true
            }
        }))
    }
    return fsmNaps
}

const gvt = (start, end, action = '', condition) => `${start} -> ${end} [label = "${action}${condition ? `\\n${condition}` : ''}"];`

function renderGraphViz({ pc0, actions, states, transitions, deterministic }) {
    const specification = getStatesFrom(states, transitions)
    actions = actions || specification.actions
    let pcEnd
    const graphVizTransitions = keys(states).map(state => {
        pcEnd = (pcEnd == null) && (states[state]?.transitions == null || first(states[state].transitions) == null) ? state : undefined 
        return states[state]?.transitions?.map(transition => {
            const condition = states[state]?.guards?.reduce(
                (a, c) => {
                    if (c.action !== transition) return a
                    const parts = c.condition.toString().split('return')
                    return parts.length > 1 ? first(parts[1]).split(';') : [c.condition.toString()]
                },
                undefined
            )
            return gvt(state, first(actions[transition]), transition, condition )
        }).join('\n')
    }).join('\n')
    
    const output = `
digraph fsm_diagram {
rankdir=LR;
size="8,5"
${pc0} [shape = circle margin=0 fixedsize=true width=0.33 fontcolor=black style=filled color=black label="\\n\\n\\n${pc0}"]
${pcEnd ? `${pcEnd} [shape = doublecircle margin=0 style=filled fontcolor=white color=black]` : '\n'}
node [shape = Mrecord];
${graphVizTransitions}
}
    `   
    return output
}

function runTimeStateDiagram(pc0, stateDiagram, deterministic) {
    stateDiagram.actions = {}
    stateDiagram.states = { [pc0]: { transitions: [] }}
    stateDiagram.step = 0
    
    return () => renderGraphViz({ pc0, actions: stateDiagram.actions, states: stateDiagram.states, deterministic })
}

function fsm ({ componentName, pc0, actions, transitions, states, composite, pc = 'pc', deterministic = false, lax = true, enforceAllowedTransitions = false, blockUnexpectedActions = false, rejectUnexpectedActions = false, schemas = {}, domains = {}, stateDiagram = {}, id = Date.now() + Math.floor(Math.random() * 100000000) }) {
    const stampProposal = (proposal) => {
        proposal.__stateMachineId = id
        return proposal
    }
    return {
        id,
        initialState: model => {
            modelSetValue(model, componentName, pc, pc0)
            model.__actionName = undefined
            return model
        },
        addAction: addAction(actions, id),

        // v2 (sam-fsm#1): the fsm's own state, declared — spread into a strict
        // sam-pattern v2 component (pc_1 is previous-state bookkeeping: internal)
        modelShape: {
            [pc]: { type: 'string' },
            [`${pc}_1`]: { type: 'string', nullable: true, internal: true }
        },

        // v2 (sam-fsm#2/#3): the FSM alphabet as a sam-pattern v2 named-intent
        // map. Each entry may be customized with a proposal creator (function or
        // { action, schema, domain }); defaults are an empty-payload creator, a
        // permissive schema, and the [[]] no-argument domain — so a bare
        // event-driven fsm passes validate() and is checker-explorable with
        // zero configuration.
        namedActions: (creators = {}) => keys(actionsFor(actions, transitions)).reduce((named, name) => {
            const definition = creators[name]
            const creator = (isFunction(definition) ? definition : definition?.action) ?? (() => ({}))
            const wrapped = function () {
                const result = creator.apply(this, arguments)
                return result && isFunction(result.then)
                    ? result.then(proposal => stampProposal(proposal || {}))
                    : stampProposal(result || {})
            }
            named[name] = {
                action: wrapped,
                schema: (isFunction(definition) ? undefined : definition?.schema) ?? schemas[name] ?? {},
                domain: (isFunction(definition) ? undefined : definition?.domain) ?? domains[name] ?? [[]]
            }
            return named
        }, {}),
        stateMachine: stateMachineReactor({ id, componentName, pc0, actions, states, composite, transitions, pc, deterministic, lax, enforceAllowedTransitions, blockUnexpectedActions, stateDiagram }),
        acceptors: stateMachineAcceptors({ id, componentName, pc0, actions, states, composite, transitions, pc, deterministic, lax, enforceAllowedTransitions, rejectUnexpectedActions, stateDiagram }),
        naps: stateMachineNaps({ id, states, componentName, composite, pc }),
        event: eventName => { 
            const action = () => ({ __actionName: eventName, __stateMachineId: id })
            action.__actionName = eventName
            action.__stateMachineId = id
            return action
        },
        stateDiagram: renderGraphViz({ pc0, actions, transitions, states, deterministic }),
        runtimeStateDiagram: runTimeStateDiagram(pc0, stateDiagram, deterministic)
    }
}

fsm.flattenTransitions = flattenTransitions
fsm.actionsAndStatesFor = actionsAndStatesFor

export default fsm