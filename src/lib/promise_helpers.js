const delay = period => new Promise(res => setTimeout(res, period))

export async function retryUntil(fn, period = 4000) {
  const pausePeriod = 1
  let count = period / pausePeriod

  while (count > 0) {
    if (await fn())
      return true
    count--
    await delay(pausePeriod)
  }
  return false
}

export async function retryUntilTimeout(fn, period = 4000) {
  const pausePeriod = 1
  let count = period / pausePeriod

  while (count > 0) {
    if (await fn())
      return true
    count--
    await delay(pausePeriod)
  }
  throw new Error('Timeout')
}

const forever = true
export async function retryForeverUntil(fn) {
  while (forever) {
    if (await fn())
      return true
    await delay(10)
  }
}
