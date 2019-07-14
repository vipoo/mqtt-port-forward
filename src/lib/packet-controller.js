import _debug from 'debug'
import {PacketCodes, extractHeader, applyHeader} from './buffer-management'
import {retryUntil} from './promise_helpers'

const debug = _debug('mqtt:pf')
const info = _debug('mqtt:pf:info')

export class PacketController {
  constructor(mqttClient, topic) {
    this.openedSockets = new Map()
    this.mqttClient = mqttClient
    this.topic = topic
    this.packetsWaitingAck = new Map()
  }

  init(extractSocketId, portNumber, direction) {
    this.mqttClient.on('message', (incomingTopic, buffer) => {
      const socketId = extractSocketId(incomingTopic)
      const {data, code, packetNumber} = extractHeader(buffer)
      if (code !== PacketCodes.Ack)
        this.mqttClient.publish(`${this.topic}/tunnel/${invertDirection}/${socketId}`,
          applyHeader(Buffer.alloc(0), PacketCodes.Ack, packetNumber), {qos: 1})

      this[code](socketId, data, packetNumber, portNumber)
    })

    const invertDirection = direction === 'down' ? 'up' : 'down'
    this.mqttClient.subscribe(`${this.topic}/tunnel/${direction}/+`, {qos: 1})
    this.mqttClient.publish(`${this.topic}/tunnel/${invertDirection}/0`, applyHeader(Buffer.alloc(0), PacketCodes.Reset, 0), {qos: 1})
  }

  publishToMqtt(socket, code, data = Buffer.alloc(0)) {
    const packetNumber = socket.nextPacketNumber++
    const dataWithHeader = applyHeader(data, code, packetNumber)
    const writeToMqtt = () => {
      debug(`${socket.id}: Sending data ${packetNumber}, code: ${code}`)
      this.mqttClient.publish(socket.dataTopic, dataWithHeader, {qos: 1})
    }

    writeToMqtt()
    const handle = setTimeout(writeToMqtt, 3000)
    this.packetsWaitingAck.set(packetNumber, handle)

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
      info(`${socket.id}: session ended.`)
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
    info('Received reset signal')

    for (const s of this.openedSockets.values()) {
      s.end()
      s.destroy()
    }

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
      info(`${socket.id}: session ended.`)
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

  [PacketCodes.Ack](socketId, data, packetNumber) {
    debug(`${socketId}: received ack for data packet ${packetNumber}`)
    const timerHandler = this.packetsWaitingAck.get(packetNumber)
    clearTimeout(timerHandler)
    this.packetsWaitingAck.delete(packetNumber)
  }
}
