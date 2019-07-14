import uuidv4 from 'uuid/v4'

export function generateId() {
  const guid = uuidv4().replace(/-/g, '')
  const r = Buffer.from(guid, 'hex').toString('base64')
  return r.slice(0, r.length - 2)
}
