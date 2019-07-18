import __debug from 'debug'
import util from 'util'

const _debug = __debug('mqtt')

const debug = {
  message: _debug.extend('message'),
  payload: _debug.extend('payload'),
  error: _debug.extend('error')
}

const events = ['connect', 'reconnect', 'close', 'disconnect', 'offline', 'end', 'message', 'packetsend', 'packetreceive']
const mappedMethods = ['publish',  'subscribe', 'unsubscribe', 'end']

export function MqttClientWithDebug(mqttClient) {

  mqttClient.on('error', err => debug.error(err))

  for (const event of events)
    mqttClient.on(event, function() {
      const topic = arguments[0]?.topic || arguments[0]?.cmd || arguments[0]
      debug.message.extend(event)(`${topic ? topic : ''}`)
      debug.payload.extend(event)(`${util.inspect(arguments[0], {compact: true, breakLength: 160})}`)
    })

  this.on = (...args) => mqttClient.on(...args)

  for (const m of mappedMethods)
    this[m] = (...args) => {
      _debug.extend(m)(args.filter(f => f !== undefined).filter(f => !(f instanceof Function)).map(f => util.inspect(f, {compact: true})).join(' '))
      return mqttClient[m](...args)
    }
}
