import _debug from 'debug'

export const debug = (t, msg) => _debug(`mqtt-socket-tunnel:${t}`)(msg)

export const debugEnabled = (t) => _debug.enabled(`mqtt-socket-tunnel:${t}`)
