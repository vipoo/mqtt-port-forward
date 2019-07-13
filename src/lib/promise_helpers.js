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

