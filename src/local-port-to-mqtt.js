import net from 'net'
import {log} from './lib/log'
import _debug from 'debug'

const debug = _debug('mqtt:pf')

class Controllers {
  static nextSocketId = 1

  constructor(mqttClient, topic) {
    this.openedSockets = new Map()
    this.mqttClient = mqttClient
    this.topic = topic
  }

  ifSocket(socketId, fn) {
    const socket = this.openedSockets.get(socketId)
    if (socket)
      fn(socket)
  }

  reset() {
    debug('Received reset signal')

    for (const s of this.openedSockets.values())
      s.destroy()

    this.openedSockets.clear()
    Controllers.nextSocketId = 1
  }

  connect(socket) {
    const socketId = Controllers.nextSocketId++
    debug(`${socketId}: starting new session`)
    socket.id = socketId
    this.openedSockets.set(socketId, socket)
    const ctrlTopic = `${this.topic}/tunnel/upstream/ctrl/${socketId}`
    const dataTopic = `${this.topic}/tunnel/upstream/data/${socketId}`

    this.mqttClient.publish(ctrlTopic, 'connect', {qos: 1})

    socket.on('end', () => {
      debug(`${socketId}: received end signal.  Forwarding to mqtt.`)
      this.mqttClient.publish(ctrlTopic, 'end', {qos: 1})
    })

    socket.on('close', () => {
      debug(`${socketId}: received close signal.  Forwarding to mqtt.`)
      this.mqttClient.publish(ctrlTopic, 'close', {qos: 1})
    })
    socket.on('data', data => {
      debug(`${socketId}: received ${data.length} bytes on socket`)
      debug(`${socketId}: socket paused`)
      socket.pause()
      this.mqttClient.publish(dataTopic, data, {qos: 1})
    })
  }

  ack(socketId) {
    debug(`${socketId}: socket resumed`)
    this.ifSocket(socketId, s => s.resume())
  }

  end(socketId) {
    debug(`${socketId}: socket end`)
    this.ifSocket(socketId, s => s.end())
    this.openedSockets.delete(socketId)
  }

  close(socketId) {
    debug(`${socketId}: socket destroy`)
    this.ifSocket(socketId, s => s.destroy())
    this.openedSockets.delete(socketId)
  }

  data(socketId, data) {
    this.mqttClient.publish(`${this.topic}/tunnel/upstream/ctrl/${socketId}`, 'ack')
    debug(`${socketId}: writing ${data.length} bytes to socket`)
    this.ifSocket(socketId, s => s.write(data))
  }
}

export async function forwardLocalPortToMqtt(mqttClient, portNumber, topic) {
  const controllers = new Controllers(mqttClient, topic)

  const socketIdPattern = new RegExp(`^${topic}/tunnel/downstream/\\w*/(\\d*)$`)
  const extractSocketId = str => parseInt(socketIdPattern.exec(str)[1])

  mqttClient.subscribe(`${topic}/tunnel/downstream/ctrl/+`, {qos: 1})
  mqttClient.subscribe(`${topic}/tunnel/downstream/data/+`, {qos: 1})
  mqttClient.publish(`${topic}/tunnel/upstream/ctrl/0`, 'reset')

  const server = net.createServer({allowHalfOpen: true}, socket =>
    controllers.connect(socket))

  server.listen(portNumber, '127.0.0.1',
    () => log.info(`Listening on ${portNumber} to forward to mqtt topics`))

  mqttClient.on('message', (incomingTopic, data) => {
    const socketId = extractSocketId(incomingTopic)

    if (socketId === 0)
      controllers.reset()

    else if (incomingTopic.startsWith(`${topic}/tunnel/downstream/ctrl/`))
      controllers[data.toString()](socketId, portNumber)

    else
      controllers.data(socketId, data)
  })
}
