/* eslint-disable no-unused-expressions */
/* eslint-disable no-undef */

// v2 integration tests: sam-fsm running under the sam-pattern 2.0 strict
// profile (issues #1-#4). Requires @cognitive-fab/sam-pattern >= 2.0.0-alpha.

const { expect } = require('chai')
const { createInstance, checker } = require('@cognitive-fab/sam-pattern')
const { fsm } = require('../dist/fsm')

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

describe('FSM v2 strict-profile integration', () => {
  describe('modelShape (#1)', () => {
    it('should emit the fsm state shape with pc_1 marked internal', () => {
      const clock = buildClock()
      expect(clock.modelShape).to.deep.equal({
        pc: { type: 'string' },
        pc_1: { type: 'string', nullable: true, internal: true }
      })
    })

    it('should honor a custom pc name', () => {
      const clock = buildClock({ pc: 'phase' })
      expect(clock.modelShape.phase).to.deep.equal({ type: 'string' })
      expect(clock.modelShape.phase_1.internal).to.be.true
    })

    it('should mount on a strict instance with no hand-written shape entries', async () => {
      const clock = buildClock()
      const instance = createInstance({ strict: true, instanceName: 'v2shape' })
      const control = instance({
        initialState: clock.initialState({}),
        component: {
          modelShape: clock.modelShape,
          actions: clock.namedActions(),
          acceptors: clock.acceptors,
          reactors: clock.stateMachine
        }
      })
      await control.intents.TOCK()
      expect(control.getState()).to.deep.equal({ pc: 'TOCKED' })
      expect(control.lastStep().classification).to.equal('mutated')
    })
  })

  describe('namedActions (#2)', () => {
    it('should expose the FSM alphabet as a named-intent map with defaults', () => {
      const clock = buildClock()
      const named = clock.namedActions()
      expect(Object.keys(named)).to.have.members(['TICK', 'TOCK'])
      expect(named.TICK.schema).to.deep.equal({})
      expect(named.TICK.domain).to.deep.equal([[]])
      expect(named.TICK.action).to.be.a('function')
    })

    it('should stamp proposals with the state machine id', () => {
      const clock = buildClock()
      const proposal = clock.namedActions().TOCK.action()
      expect(proposal.__stateMachineId).to.equal(clock.id)
    })

    it('should accept custom creators, schemas and domains', async () => {
      const clock = buildClock({
        schemas: { TOCK: { loud: { type: 'boolean', required: true } } },
        domains: { TOCK: [[true], [false]] }
      })
      const named = clock.namedActions({
        TOCK: loud => ({ loud })
      })
      expect(named.TOCK.schema).to.deep.equal({ loud: { type: 'boolean', required: true } })
      expect(named.TOCK.domain).to.deep.equal([[true], [false]])
      const proposal = await named.TOCK.action(true)
      expect(proposal).to.deep.include({ loud: true })
    })

    it('should pass validate() on a strict instance with zero extra declarations', () => {
      const clock = buildClock()
      const instance = createInstance({ strict: true, instanceName: 'v2validate' })
      const control = instance({
        initialState: clock.initialState({}),
        component: {
          modelShape: clock.modelShape,
          actions: clock.namedActions(),
          acceptors: clock.acceptors,
          reactors: clock.stateMachine
        }
      })
      expect(control.validate()).to.deep.equal([])
    })
  })

  describe('domains drive the checker (#3)', () => {
    it('should model-check the fsm with zero checker-side configuration', () => {
      const clock = buildClock()
      const instance = createInstance({
        strict: true, hasAsyncActions: false, instanceName: 'v2checker'
      })
      const control = instance({
        initialState: clock.initialState({}),
        component: {
          modelShape: clock.modelShape,
          actions: clock.namedActions(),
          acceptors: clock.acceptors,
          reactors: clock.stateMachine
        },
        render: () => {}
      })

      const reached = []
      checker({
        instance,
        initialState: { pc: 'TICKED', pc_1: null },
        reset: init => control.setState(init),
        liveness: state => state.pc === 'TOCKED',
        options: { depthMax: 2 }
      }, () => reached.push(true))

      expect(reached.length, 'TOCKED is reachable through declared domains').to.be.greaterThan(0)
    })
  })

  describe('rejectUnexpectedActions (#4)', () => {
    it('should classify an invalid transition as rejected on a strict instance', async () => {
      const clock = buildClock({ rejectUnexpectedActions: true })
      const instance = createInstance({ strict: true, instanceName: 'v2reject' })
      const control = instance({
        initialState: clock.initialState({}),
        component: {
          modelShape: clock.modelShape,
          actions: clock.namedActions(),
          acceptors: clock.acceptors,
          reactors: clock.stateMachine
        }
      })

      await control.intents.TICK() // TICK is invalid from TICKED
      const step = control.lastStep()
      expect(step.classification).to.equal('rejected')
      expect(step.rejections[0].reason).to.equal('unexpected action TICK for state: TICKED')
      expect(control.getState().pc).to.equal('TICKED')
      expect(control.hasError).to.equal(false)

      await control.intents.TOCK() // valid
      expect(control.lastStep().classification).to.equal('mutated')
      expect(control.getState().pc).to.equal('TOCKED')
    })

    it('should fall back to the __error slot when no step API is available (v1 behavior)', () => {
      const clock = buildClock({ rejectUnexpectedActions: true })
      const acceptor = clock.acceptors[clock.acceptors.length - 1]
      const model = { pc: 'TICKED' }
      acceptor(model)({ __actionName: 'TICK', __stateMachineId: clock.id }) // no stepApi
      expect(model.__error).to.equal('unexpected action TICK for state: TICKED')
    })

    it('should keep the __error behavior by default', async () => {
      const clock = buildClock() // rejectUnexpectedActions off
      const instance = createInstance({ strict: true, instanceName: 'v2errDefault' })
      const control = instance({
        initialState: clock.initialState({}),
        component: {
          modelShape: clock.modelShape,
          actions: clock.namedActions(),
          acceptors: clock.acceptors,
          reactors: clock.stateMachine
        }
      })
      await control.intents.TICK()
      expect(instance({}).hasError).to.equal(true)
    })
  })
})
