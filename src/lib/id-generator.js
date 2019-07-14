import uuidv4 from 'uuid/v4'
import bs58 from 'bs58'

export function generateId() {
  const guid = uuidv4().replace(/-/g, '')
  const r = bs58.encode(Buffer.from(guid, 'hex'))
  return r.slice(0, r.length - 2)
}
