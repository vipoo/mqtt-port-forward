import _debug from 'debug'
import mqtt from 'mqtt'
import tls from 'tls'
import util from 'util'

const debug = {
  publish: _debug('mqtt:publish'),
  message: _debug('mqtt:message'),
  payload: _debug('mqtt:payload'),
  error: _debug('mqtt:error'),
  enabled: () => _debug.enabled('mqtt:')
}

function tlsConnection(options) {

  const mqttClientOptions = {
    enableTrace: false,
    host: options.host,
    port: 8883,
    requestCert: true,
    rejectUnauthorized: true,
    ca: options.ca,
    key: options.key,
    cert: options.cert
  }
  return mqttClient => {
    const tlsConnection = tls.connect(mqttClientOptions)

    function handleTLSerrors(err) {
      mqttClient.emit('error', err)
      tlsConnection.end()
    }

    tlsConnection.on('secureConnect', () => {
      if (!tlsConnection.authorized)
        tlsConnection.emit('error', new Error('TLS not authorized'))
      else
        tlsConnection.removeListener('error', handleTLSerrors)
    })

    tlsConnection.on('error', handleTLSerrors)
    return tlsConnection
  }
}

const events = ['connect', 'reconnect', 'close', 'disconnect', 'offline', 'end', 'message', 'packetsend', 'packetreceive']

class MqttClient extends mqtt.MqttClient {
  constructor(...args) {
    super(...args)
  }

  publish(...args) {
    debug.publish(args[0])
    return super.publish(...args)
  }
}

export async function createMqttClient(options) {
  const tlsConnector = await tlsConnection(options)
  const client = new MqttClient(tlsConnector, options)

  client.on('error', err => debug.error(err))

  if (debug.enabled())
    for (const event of events)
      client.on(event, function() {
        const topic = arguments[0]?.topic || arguments[0]?.cmd || arguments[0]
        debug.message(`${event}: ${topic ? topic : ''}`)
        debug.payload(`${event}: ${util.inspect(...arguments)}`)
      })

  return client
}
