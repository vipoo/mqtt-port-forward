import chaiAsPromised from 'chai-as-promised'
export {default as sinon} from 'sinon'
import sinon from 'sinon'
import chai from 'chai'
import sinonChai from 'sinon-chai'

chai.use(chaiAsPromised)
chai.use(sinonChai)

export const expect = chai.expect
export const subjectEach = beforeEach
export const given = (d, fn) => context(`given ${d}`, fn)
export const when = (d, fn) => context(`when ${d}`, fn)
export const then = (d, fn) => it(`then ${d}`, fn)

when.only = context.only // eslint-disable-line
then.only = it.only // eslint-disable-line

afterEach(() => sinon.restore())

before.withTimeout = (t) => {
  return b => before(function() {
    this.timeout(t)
    return b()
  })
}

after.withTimeout = (t) => {
  return b => after(function() {
    this.timeout(t)
    return b()
  })
}

const _setTimeout = setTimeout //capture non fake timer
const _clearTimeout = clearTimeout
export const delay = period => new Promise(res => _setTimeout(res, period))

chai.Assertion.addMethod('iterateTo', async function(expectedValues) {
  const result = []
  for await (const x of this._obj)
    result.push(x)

  return new chai.Assertion(result).to.deep.eq(expectedValues)
})

const unique = Symbol('unique')
async function getPromiseState(p) {
  return Promise.race([p, Promise.resolve(unique)])
    .then(y => y === unique ? 'pending' : 'resolved', () => 'rejected')
}

chai.Assertion.addProperty('pending', async function() {
  const state = await getPromiseState(this._obj)

  if (this.__flags.negate)
    return new chai.Assertion(state).to.not.eq('pending')
  else
    return new chai.Assertion(state).to.eq('pending')
})

export async function eventually(fn, timeout = 1800) {
  let lastError = null
  let timedOut = false
  const timer = _setTimeout(() => timedOut = true, timeout)

  while (!timedOut)
    try {
      return await fn()
    } catch (err) {
      lastError = err
      await delay(10)
    }

  _clearTimeout(timer)
  throw lastError
}

export function fakeTimer() {
  const _hrtime = process.hrtime
  const stubHrTime = {}
  if (process.hrtime) {
    stubHrTime.bigint = _hrtime.bigint
    sinon.stub(process, 'hrtime').value(stubHrTime)
  }
  return sinon.useFakeTimers()
}

