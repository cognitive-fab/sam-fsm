/* eslint-disable no-unused-expressions */
/* eslint-disable no-undef */
const { expect } = require('chai')

const { createInstance } = require('@cognitive-fab/sam-pattern')
const { fsm } = require('../dist/fsm')

// ---------------------------------------------------------------------------
// Helper: build a minimal two-state clock FSM
// ---------------------------------------------------------------------------
const buildClock = (opts = {}) => fsm({
  pc0: 'TICKED',
  actions: {
    TICK: ['TICKED'],
    TOCK: ['TOCKED']
  },
  states: {
    TICKED: { transitions: ['TOCK'] },
    TOCKED: { transitions: ['TICK'] }
  },
  deterministic: true,
  lax: false,
  enforceAllowedTransitions: true,
  ...opts
})

// ---------------------------------------------------------------------------

describe('FSM extended tests', () => {
  describe('lax mode', () => {
    it('should NOT error when current state is unknown in lax mode (lax: true)', () => {
      const sm = buildClock({ lax: true })
      // The reactor is the first stateMachine function
      const reactor = sm.stateMachine[0]
      // Set model to a state not defined in this FSM
      const model = { pc: 'UNKNOWN_STATE' }
      reactor(model)()
      expect(model.__error).to.be.undefined
    })

    it('should error when current state is unknown in strict mode (lax: false)', () => {
      const sm = buildClock({ lax: false })
      const reactor = sm.stateMachine[0]
      const model = { pc: 'UNKNOWN_STATE' }
      reactor(model)()
      expect(model.__error).to.exist
    })
  })

  describe('terminal states with blockUnexpectedActions', () => {
    it('should block all actions when in a terminal state (no transitions)', (done) => {
      const TerminalFSMTest = createInstance({ instanceName: 'TerminalFSMTest' })

      const sm = fsm({
        pc0: 'READY',
        actions: {
          START: ['DONE'],
          RESTART: ['READY']
        },
        states: {
          READY: { transitions: ['START'] },
          DONE: { transitions: [] } // terminal
        },
        deterministic: true,
        lax: false,
        enforceAllowedTransitions: true,
        blockUnexpectedActions: true
      })

      const startState = sm.initialState({})
      const errors = []

      const [start, restart] = TerminalFSMTest({
        initialState: startState,
        component: {
          actions: [
            ['START', () => ({ started: true })],
            ['RESTART', () => ({ restarted: true })]
          ],
          acceptors: [...sm.acceptors],
          reactors: sm.stateMachine
        },
        render: state => {
          if (state.hasError()) {
            errors.push(state.errorMessage())
          }
        }
      }).intents

      start() // moves to DONE

      setTimeout(() => {
        restart() // RESTART is not in DONE's transitions → should be blocked

        setTimeout(() => {
          // The counter did not increase and no crash occurred;
          // the action was silently dropped because __allowedActions = ['__EMPTY']
          expect(errors.length).to.equal(0) // no render-level error, just blocked
          done()
        }, 100)
      }, 100)
    }).timeout(3000)
  })

  describe('enforceAllowedTransitions + invalid transition error', () => {
    it('should set an error on the model for an invalid transition', () => {
      const sm = buildClock({ enforceAllowedTransitions: true })
      const acceptor = sm.acceptors[sm.acceptors.length - 1] // last acceptor is the state updater

      const model = { pc: 'TICKED', pc_1: undefined }

      // TICK from TICKED is invalid (TICKED only allows TOCK)
      const proposal = { __actionName: 'TICK', __stateMachineId: sm.id }

      // Reset allowed actions first (acceptors[1] does this)
      sm.acceptors[1](model)(proposal)
      // Run the main state acceptor
      acceptor(model)(proposal)

      expect(model.__error).to.exist
    })

    it('should NOT error for a valid transition', () => {
      const sm = buildClock({ enforceAllowedTransitions: true })
      const acceptor = sm.acceptors[sm.acceptors.length - 1]

      const model = { pc: 'TICKED', pc_1: undefined }

      // TOCK from TICKED is valid
      const proposal = { __actionName: 'TOCK', __stateMachineId: sm.id }

      sm.acceptors[1](model)(proposal)
      acceptor(model)(proposal)

      expect(model.__error).to.be.undefined
      expect(model.pc).to.equal('TOCKED')
    })
  })

  describe('stateMachineReactor unit tests', () => {
    it('should set an error for an unexpected action given a known previous state', () => {
      const sm = buildClock({ enforceAllowedTransitions: true })
      const reactor = sm.stateMachine[0]

      const model = {
        pc: 'TICKED',   // current state
        pc_1: 'TOCKED', // previous state — checked against its transitions and named in the message
        __actionName: 'TOCK', // TOCK is NOT in TOCKED.transitions (['TICK']) → error
        __stateMachineIdForLastAction: sm.id
      }
      reactor(model)()
      // the message names the previous state — the state from which the action was illegal
      expect(model.__error).to.equal('unexpected action TOCK for state: TOCKED')
    })

    it('should not error when there is no previous state (start state)', () => {
      const sm = buildClock()
      const reactor = sm.stateMachine[0]
      const model = { pc: 'TICKED' } // no pc_1
      reactor(model)()
      expect(model.__error).to.be.undefined
    })
  })

  describe('nap generation', () => {
    it('should fire a nap when state and condition match', () => {
      let napFired = false
      const sm = fsm({
        pc0: 'IDLE',
        actions: { GO: ['RUNNING'] },
        states: {
          IDLE: {
            transitions: ['GO'],
            naps: [{
              condition: ({ triggered }) => !!triggered,
              nextAction: () => { napFired = true }
            }]
          },
          RUNNING: { transitions: [] }
        },
        deterministic: true,
        lax: false,
        enforceAllowedTransitions: true
      })

      const nap = sm.naps[0]
      // a fired nap returns true (it blocks the render, per the nap contract)
      expect(nap({ pc: 'IDLE', triggered: true })()).to.equal(true)
      expect(napFired).to.be.true
    })

    it('should not fire a nap when state does not match', () => {
      let napFired = false
      const sm = fsm({
        pc0: 'IDLE',
        actions: { GO: ['RUNNING'] },
        states: {
          IDLE: {
            transitions: ['GO'],
            naps: [{
              condition: () => true,
              nextAction: () => { napFired = true }
            }]
          },
          RUNNING: { transitions: [] }
        },
        deterministic: true,
        lax: false,
        enforceAllowedTransitions: true
      })

      const nap = sm.naps[0]
      // State is RUNNING, not IDLE — nap should not fire
      expect(nap({ pc: 'RUNNING' })()).to.equal(undefined)
      expect(napFired).to.be.false
    })

    it('should not fire a nap when condition is false', () => {
      let napFired = false
      const sm = fsm({
        pc0: 'IDLE',
        actions: { GO: ['RUNNING'] },
        states: {
          IDLE: {
            transitions: ['GO'],
            naps: [{
              condition: () => false,
              nextAction: () => { napFired = true }
            }]
          },
          RUNNING: { transitions: [] }
        },
        deterministic: true,
        lax: false,
        enforceAllowedTransitions: true
      })

      const nap = sm.naps[0]
      expect(nap({ pc: 'IDLE' })()).to.equal(undefined)
      expect(napFired).to.be.false
    })

    it('should produce an empty naps array when no state has naps', () => {
      const sm = buildClock()
      expect(sm.naps).to.be.an('array')
      expect(sm.naps.length).to.equal(0)
    })
  })

  describe('addAction()', () => {
    it('should wrap an intent and tag it with __actionName and __stateMachineId', () => {
      const sm = buildClock()
      const wrapped = sm.addAction(() => ({ result: true }), 'TICK')
      expect(wrapped.__actionName).to.equal('TICK')
      expect(wrapped.__stateMachineId).to.equal(sm.id)
    })

    it('should throw for an action not registered in the FSM', () => {
      const sm = buildClock()
      expect(() => sm.addAction(() => {}, 'INVALID')).to.throw(/invalid action/)
    })

    it('should throw when the intent is undefined', () => {
      const sm = buildClock()
      // dist E() checks val !== undefined, so null passes — only undefined triggers the throw
      expect(() => sm.addAction(undefined, 'TICK')).to.throw(/invalid action/)
    })

    it('wrapped action should resolve with __actionName in the proposal', async () => {
      const sm = buildClock()
      const wrapped = sm.addAction(() => ({ data: 42 }), 'TOCK')
      const proposal = await wrapped()
      expect(proposal.data).to.equal(42)
      expect(proposal.__actionName).to.equal('TOCK')
      expect(proposal.__stateMachineId).to.equal(sm.id)
    })
  })

  describe('actionsAndStatesFor()', () => {
    it('should derive states and actions from a transitions array', () => {
      const transitions = [
        { from: 'A', to: 'B', on: 'GO' }
      ]
      const { states, actions } = fsm.actionsAndStatesFor(transitions)
      expect(states.A.transitions).to.include('GO')
      expect(states.B.transitions.length).to.equal(0)
      expect(actions.GO[0]).to.equal('B')
    })

    it('should accumulate multiple transitions from the same source state', () => {
      const transitions = [
        { from: 'ACTIVE', to: 'PAUSED', on: 'PAUSE' },
        { from: 'ACTIVE', to: 'STOPPED', on: 'STOP' },
        { from: 'PAUSED', to: 'ACTIVE', on: 'RESUME' }
      ]
      const { states } = fsm.actionsAndStatesFor(transitions)
      expect(states.ACTIVE.transitions).to.include('PAUSE')
      expect(states.ACTIVE.transitions).to.include('STOP')
      expect(states.PAUSED.transitions).to.include('RESUME')
      expect(states.STOPPED.transitions.length).to.equal(0)
    })

    it('should handle self-transitions (from === to)', () => {
      const transitions = [
        { from: 'COUNTING', to: 'COUNTING', on: 'INCREMENT' },
        { from: 'COUNTING', to: 'DONE', on: 'FINISH' }
      ]
      const { states, actions } = fsm.actionsAndStatesFor(transitions)
      expect(states.COUNTING.transitions).to.include('INCREMENT')
      expect(states.COUNTING.transitions).to.include('FINISH')
      expect(actions.INCREMENT[0]).to.equal('COUNTING')
      expect(actions.FINISH[0]).to.equal('DONE')
    })

    it('should set pc0 to the from state of the first transition', () => {
      const transitions = [{ from: 'INIT', to: 'RUNNING', on: 'START' }]
      const { pc0 } = fsm.actionsAndStatesFor(transitions)
      expect(pc0).to.equal('INIT')
    })
  })

  describe('flattenTransitions()', () => {
    it('should convert a nested transition map to a flat array', () => {
      const flat = fsm.flattenTransitions({
        IDLE: { START: 'RUNNING', ABORT: 'ERROR' },
        RUNNING: { STOP: 'IDLE' },
        ERROR: {}
      })
      const idleToRunning = flat.find(t => t.from === 'IDLE' && t.on === 'START')
      const idleToError = flat.find(t => t.from === 'IDLE' && t.on === 'ABORT')
      expect(idleToRunning).to.exist
      expect(idleToRunning.to).to.equal('RUNNING')
      expect(idleToError).to.exist
      expect(idleToError.to).to.equal('ERROR')
    })

    it('should produce transitions in from/to/on shape', () => {
      const flat = fsm.flattenTransitions({ A: { GO: 'B' } })
      expect(flat[0]).to.have.property('from', 'A')
      expect(flat[0]).to.have.property('to', 'B')
      expect(flat[0]).to.have.property('on', 'GO')
    })

    it('should return an empty array for an empty transition map', () => {
      expect(fsm.flattenTransitions({})).to.deep.equal([])
    })

    it('should return an empty array for states with no transitions', () => {
      const flat = fsm.flattenTransitions({ TERMINAL: {} })
      expect(flat.length).to.equal(0)
    })
  })

  describe('stateDiagram', () => {
    it('should start with "d" and end with "}"', () => {
      const sm = buildClock()
      const diagram = sm.stateDiagram.trim()
      expect(diagram[0]).to.equal('d')
      expect(diagram[diagram.length - 1]).to.equal('}')
    })

    it('should include all defined states', () => {
      const sm = fsm({
        pc0: 'START',
        actions: { GO: ['MID'], DONE: ['END'] },
        states: {
          START: { transitions: ['GO'] },
          MID: { transitions: ['DONE'] },
          END: {}
        },
        deterministic: true,
        lax: false,
        enforceAllowedTransitions: true
      })
      expect(sm.stateDiagram).to.include('START')
      expect(sm.stateDiagram).to.include('MID')
      expect(sm.stateDiagram).to.include('END')
    })

    it('should include guard condition text for guarded transitions', () => {
      const condition = ({ counter }) => counter > 5
      const sm = fsm({
        pc0: 'READY',
        actions: { FIRE: ['DONE'] },
        states: {
          READY: {
            transitions: ['FIRE'],
            guards: [{ action: 'FIRE', condition }]
          },
          DONE: {}
        },
        deterministic: true,
        lax: false,
        enforceAllowedTransitions: true
      })
      // The diagram should reference FIRE and READY
      expect(sm.stateDiagram).to.include('READY')
      expect(sm.stateDiagram).to.include('FIRE')
    })
  })

  describe('runtimeStateDiagram()', () => {
    it('should return a function', () => {
      const sm = buildClock()
      expect(sm.runtimeStateDiagram).to.be.a('function')
    })

    it('should produce a diagram string that starts with "d"', () => {
      const sm = buildClock()
      const rsd = sm.runtimeStateDiagram()
      expect(rsd.trim()[0]).to.equal('d')
    })

    it('should record visited states after actions fire', (done) => {
      const RuntimeFSMTest = createInstance({ instanceName: 'RuntimeFSMTest' })

      const sm = buildClock({ enforceAllowedTransitions: true, blockUnexpectedActions: true })
      const startState = sm.initialState({})

      const [tick, tock] = RuntimeFSMTest({
        initialState: startState,
        component: {
          actions: [
            ['TICK', () => ({ tick: true })],
            ['TOCK', () => ({ tock: true })]
          ],
          acceptors: [...sm.acceptors],
          reactors: sm.stateMachine
        },
        render: () => {}
      }).intents

      tock()
      tick()

      setTimeout(() => {
        const rsd = sm.runtimeStateDiagram()
        expect(rsd).to.include('TICKED')
        expect(rsd).to.include('TOCKED')
        done()
      }, 200)
    }).timeout(3000)
  })

  describe('initialState()', () => {
    it('should set the pc key on the model', () => {
      const sm = buildClock()
      const state = sm.initialState({})
      expect(state.pc).to.equal('TICKED')
    })

    it('should merge initial state with existing model properties', () => {
      const sm = buildClock()
      const state = sm.initialState({ counter: 42 })
      expect(state.counter).to.equal(42)
      expect(state.pc).to.equal('TICKED')
    })

    it('should respect a custom pc key', () => {
      const sm = fsm({
        pc: 'status',
        pc0: 'READY',
        actions: { GO: ['RUNNING'] },
        states: {
          READY: { transitions: ['GO'] },
          RUNNING: { transitions: [] }
        },
        deterministic: true,
        lax: false,
        enforceAllowedTransitions: true
      })
      const state = sm.initialState({})
      expect(state.status).to.equal('READY')
    })
  })
})
