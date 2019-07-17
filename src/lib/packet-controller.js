import _debug from 'debug'
import {PacketCodes, extractHeader, applyHeader} from './buffer-management'
import {retryUntil} from './promise_helpers'

const debug = _debug('mqtt:pf')
const info = _debug('mqtt:pf:info')

const mqttTimeout = 60000 * 2 // Period to close socket if no mqtt packets received
const resentPeriod = 1000 // Period to wait to resent unacknowledged

export class PacketController {
  constructor(mqttClient, topic, direction) {
    this.openedSockets = new Map()
    this.mqttClient = mqttClient
    this.topic = topic
    this.packetsWaitingAck = new Map()
    this.direction = direction
  }

  init(extractSocketId, portNumber) {
    this.mqttClient.on('message', (incomingTopic, buffer) => {
      const socketId = extractSocketId(incomingTopic)
      const {data, code, packetNumber} = extractHeader(buffer)
      if (code !== PacketCodes.Ack)
        this.mqttClient.publish(`${this.topic}/tunnel/${invertDirection}/${socketId}`,
          applyHeader(Buffer.alloc(0), PacketCodes.Ack, packetNumber), {qos: 1})

      this[code](socketId, data, packetNumber, portNumber)
    })

    const invertDirection = this.direction === 'down' ? 'up' : 'down'
    debug(`${this.direction}: subscribing to ${this.topic}/tunnel/${this.direction}/+`)
    this.mqttClient.subscribe(`${this.topic}/tunnel/${this.direction}/+`, {qos: 1})
  }

  rescheudleSocketTimeout(socketId) {
    const socket = this.openedSockets.get(socketId)
    if (!socket)
      return
    clearTimeout(socket.timeoutHandler)
    socket.timeoutHandler = setTimeout(() => {
      debug(`${this.direction}: Socket closed due to no mqtt traffic recieved`)
      socket.end()
      socket.destroy()
      this.openedSockets.delete(socketId)
    }, mqttTimeout)
  }

  publishToMqtt(socket, code, data = Buffer.alloc(0)) {
    const packetNumber = socket.nextPacketNumber++
    const dataWithHeader = applyHeader(data, code, packetNumber)
    const writeToMqtt = () => {
      debug(`${this.direction} ${socket.id}: Sending data ${packetNumber}, code: ${code} to topic ${socket.dataTopic}`)
      this.mqttClient.publish(socket.dataTopic, dataWithHeader, {qos: 1})
    }

    writeToMqtt()
    const handle = setTimeout(writeToMqtt, resentPeriod)
    this.packetsWaitingAck.set(packetNumber, handle)

    return packetNumber
  }

  async syncPackets(socketId, packetNumber, fn) {
    await retryUntil(() => this.openedSockets.has(socketId))
    const socket = this.openedSockets.get(socketId)

    if (!socket || socket.nextIncomingPacket > packetNumber)
      return // old packet - ignore must be a repeat

    await retryUntil(() => socket.nextIncomingPacket === packetNumber)
    if (socket.nextIncomingPacket !== packetNumber)
      throw new Error(`Expected ${socket.nextIncomingPacket} but got ${packetNumber}`)
    socket.nextIncomingPacket++

    fn(socket)
  }

  manageSocketEvents(socket) {
    socket.on('data', data => {
      debug(`${this.direction} ${socket.id}: received packet ${socket.nextPacketNumber}, containing ${data.length} bytes on socket`)
      this.publishToMqtt(socket, PacketCodes.Data, data)
    })

    socket.on('end', () => {
      this.publishToMqtt(socket, PacketCodes.End)
      info(`${this.direction} ${socket.id}: session ended.`)
      debug(`${this.direction} ${socket.id}: received end signal.  Forwarding to mqtt.`)
      this.openedSockets.delete(socket.id)
      clearTimeout(socket.timeoutHandler)
    })

    socket.on('close', () => {
      this.publishToMqtt(socket, PacketCodes.Close)
      debug(`${this.direction} ${socket.id}: received close signal.  Forwarding to mqtt.`)
      this.openedSockets.delete(socket.id)
      clearTimeout(socket.timeoutHandler)
    })
  }

  reset() {
    debug(`${this.direction} Closing all sockets`)
    for (const s of this.openedSockets.values()) {
      s.end()
      s.destroy()
    }

    this.openedSockets.clear()
  }

  [PacketCodes.End](socketId, data, packetNumber) {
    this.rescheudleSocketTimeout(socketId)
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${this.direction} ${socketId}: socket end`)
      socket.end()
      this.openedSockets.delete(socketId)
      clearTimeout(socket.timeoutHandler)
    })
  }

  [PacketCodes.Close](socketId, data, packetNumber) {
    this.rescheudleSocketTimeout(socketId)
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${this.direction} ${socketId}: socket close`)
      info(`${this.direction} ${socket.id}: session ended.`)
      socket.destroy()
      this.openedSockets.delete(socketId)
      clearTimeout(socket.timeoutHandler)
    })
  }

  [PacketCodes.Data](socketId, data, packetNumber) {
    this.rescheudleSocketTimeout(socketId)
    debug(`${this.direction} ${socketId}: received data packed ${packetNumber} containing ${data.length} bytes`)
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${this.direction} ${socketId}: writing data packet ${packetNumber}, containing ${data.length} bytes, to local socket`)
      socket.write(data)
    })
  }

  [PacketCodes.Ack](socketId, data, packetNumber) {
    this.rescheudleSocketTimeout(socketId)
    debug(`${this.direction} ${socketId}: received ack for data packet ${packetNumber}`)
    const timerHandler = this.packetsWaitingAck.get(packetNumber)
    clearTimeout(timerHandler)
    this.packetsWaitingAck.delete(packetNumber)
  }
}
