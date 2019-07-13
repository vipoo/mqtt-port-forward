import _debug from 'debug'
import {PacketCodes, extractHeader, applyHeader} from './buffer-management'
import {retryUntil} from './promise_helpers'

const debug = _debug('mqtt:pf')

export class PacketController {
  constructor(mqttClient, topic) {
    this.openedSockets = new Map()
    this.mqttClient = mqttClient
    this.topic = topic
    this.nextSocketId = 1
  }

  init(extractSocketId, portNumber, direction) {
    this.mqttClient.on('message', (incomingTopic, buffer) => {
      const socketId = extractSocketId(incomingTopic)
      const {data, code, packetNumber} = extractHeader(buffer)
      this[code](socketId, data, packetNumber, portNumber)
    })

    const invertDirection = direction === 'down' ? 'up' : 'down'
    this.mqttClient.subscribe(`${this.topic}/tunnel/${direction}/+`, {qos: 1})
    this.mqttClient.publish(`${this.topic}/tunnel/${invertDirection}/0`, applyHeader(Buffer.alloc(0), PacketCodes.Reset, 0))
  }

  publishToMqtt(socket, code, data = Buffer.alloc(0)) {
    const packetNumber = socket.nextPacketNumber++
    const dataWithHeader = applyHeader(data, code, packetNumber)
    this.mqttClient.publish(socket.dataTopic, dataWithHeader, {qos: 1})
    return packetNumber
  }

  async syncPackets(socketId, packetNumber, fn) {
    const socket = this.openedSockets.get(socketId)
    if (!socket)
      return

    if (socket.nextIncomingPacket > packetNumber)
      return // old packet - ignore must be a repeat

    await retryUntil(() => socket.nextIncomingPacket === packetNumber)
    if (socket.nextIncomingPacket !== packetNumber)
      throw new Error(`Expected ${socket.nextIncomingPacket} but got ${packetNumber}`)
    socket.nextIncomingPacket++

    fn(socket)
  }

  manageSocketEvents(socket) {
    socket.on('data', data => {
      const packetNumber = this.publishToMqtt(socket, PacketCodes.Data, data)
      debug(`${socket.id}: received packet ${packetNumber}, containing ${data.length} bytes on socket`)
    })

    socket.on('end', () => {
      this.publishToMqtt(socket, PacketCodes.End)
      debug(`${socket.id}: received end signal.  Forwarding to mqtt.`)
      this.openedSockets.delete(socket.id)
    })

    socket.on('close', () => {
      this.publishToMqtt(socket, PacketCodes.Close)
      debug(`${socket.id}: received close signal.  Forwarding to mqtt.`)
      this.openedSockets.delete(socket.id)
    })
  }

  reset() {
    return this[PacketCodes.Reset]()
  }

  [PacketCodes.Reset]() {
    debug('Received reset signal')

    for (const s of this.openedSockets.values())
      s.destroy()

    this.openedSockets.clear()
  }

  [PacketCodes.End](socketId, data, packetNumber) {
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${socketId}: socket end`)
      socket.end()
      this.openedSockets.delete(socketId)
    })
  }

  [PacketCodes.Close](socketId, data, packetNumber) {
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${socketId}: socket close`)
      socket.destroy()
      this.openedSockets.delete(socketId)
    })
  }

  [PacketCodes.Data](socketId, data, packetNumber) {
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${socketId}: writing data packet ${packetNumber}, containing ${data.length} bytes, to local socket`)
      socket.write(data)
    })
  }
}
