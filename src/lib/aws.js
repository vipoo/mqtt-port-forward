import _AWS from 'aws-sdk'

export const AWS = _AWS

function promiseAlways(name) {
  return function(params) {
    const module = new AWS[name]({...params})
    for (const x of Object.getOwnPropertyNames(Object.getPrototypeOf(module)))
      this[x] = function() { return module[x](...arguments).promise() }
  }
}

export function AWSP(sdkName, ...args) {
  const sdk = promiseAlways(sdkName)
  return new sdk(...args)
}

export default {AWS, AWSP}
