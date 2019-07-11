import {expect} from './test_helper'
import {spike} from '../src/index'

describe('spike', () => {
  it('returns spike', () => {
    return expect(spike()).to.eq('spike')
  })
})
