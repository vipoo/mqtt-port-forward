import net from 'net'
import {log} from './lib/log'
import _debug from 'debug'
import {applyHeader, extractHeader} from './lib/buffer-management'

const debug = _debug('mqtt:pf')

class Controllers {
  constructor(mqttClient, topic) {
    this.mqttClient = mqttClient
    this.openedSockets = new Map()
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
  }

  connect(socketId, portNumber) {
    const socket = new net.Socket()
    socket.id = socketId
    socket.nextPacketNumber = 1
    this.openedSockets.set(socketId, socket)

    socket.on('data', data => {
      const packetNumber = socket.nextPacketNumber++
      debug(`${socketId}: received packet ${packetNumber}, containing ${data.length} bytes on socket`)
      debug(`${socketId}: socket paused`)
      socket.pause()
      const dataWithHeader = applyHeader(data, 1, packetNumber)
      this.mqttClient.publish(`${this.topic}/tunnel/downstream/data/${socketId}`, dataWithHeader, {qos: 1})
    })

    socket.on('end', () => {
      debug(`${socketId}: received end signal.  Forwarding to mqtt.`)
      this.mqttClient.publish(`${this.topic}/tunnel/downstream/ctrl/${socketId}`, 'end')

      this.openedSockets.delete(socketId)
    })

    socket.on('close', () => {
      debug(`${socketId}: received close signal.  Forwarding to mqtt.`)
      this.mqttClient.publish(`${this.topic}/tunnel/downstream/ctrl/${socketId}`, 'close')

      this.openedSockets.delete(socketId)
    })

    debug(`${socketId}: Establishing connection to local port ${portNumber}`)
    socket.connect(portNumber, '127.0.0.1')
  }

  ack(socketId) {
    debug(`${socketId}: socket resumed`)
    this.ifSocket(socketId, s => s.resume())
  }

  end(socketId) {
    debug(`${socketId}: ending local socket`)
    this.ifSocket(socketId, s => s.end())
    this.openedSockets.delete(socketId)
  }

  close(socketId) {
    debug(`${socketId}: closing local socket`)
    this.ifSocket(socketId, s => s.destroy())
    this.openedSockets.delete(socketId)
  }

  data(socketId, buffer) {
    this.mqttClient.publish(`${this.topic}/tunnel/downstream/ctrl/${socketId}`, 'ack')
    const {data, code, packetNumber} = extractHeader(buffer)
    debug(`${socketId}: ${code}: writing packet ${packetNumber}, containing ${data.length} bytes, to local socket`)
    this.ifSocket(socketId, s => s.write(data))
  }
}

export async function forwardMqttToLocalPort(mqttClient, portNumber, topic) {
  const controllers = new Controllers(mqttClient, topic)

  const socketIdPattern = new RegExp(`^${topic}/tunnel/upstream/\\w*/(\\d*)$`)
  const extractSocketId = str => parseInt(socketIdPattern.exec(str)[1])

  mqttClient.publish(`${topic}/tunnel/downstream/ctrl/0`, 'reset')
  mqttClient.subscribe(`${topic}/tunnel/upstream/ctrl/+`, {qos: 1})
  mqttClient.subscribe(`${topic}/tunnel/upstream/data/+`, {qos: 1})
  mqttClient.on('connect', () => log.info(`Listening on mqtt topics ${topic}/tunnel/downstream* to forward to port ${portNumber}`))
  mqttClient.on('message', (incomingTopic, data) => {
    const socketId = extractSocketId(incomingTopic)

    if (socketId === 0)
      controllers.reset()

    else if (incomingTopic.startsWith(`${topic}/tunnel/upstream/ctrl/`))
      controllers[data.toString()](socketId, portNumber)

    else
      controllers.data(socketId, data)
  })
}
