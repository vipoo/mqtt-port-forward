import mqtt from 'mqtt'
import tls from 'tls'
import {MqttClientWithDebug} from './mqtt-with-debug'

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

export async function createMqttClient(options) {
  const tlsConnector = await tlsConnection(options)
  return new MqttClientWithDebug(new mqtt.MqttClient(tlsConnector, options))
}
