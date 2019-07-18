import _debug from 'debug'
import {PacketCodes, extractHeader, applyHeader} from './buffer-management'
import {retryUntil} from './promise_helpers'

const debug = _debug('mqtt:pf')
const info = _debug('mqtt:pf:info')

const mqttTimeout = 60000 * 2 // Period to close socket if no mqtt packets received
const resentPeriod = 1000 // Period to wait to resent unacknowledged

function removeSocket(openedSockets, socket) {
  socket.end()
  socket.destroy()
  clearTimeout(socket.timeoutHandler)

  openedSockets.delete(socket.id)

  if (socket.packetsWaitingAck)
    for (const x of socket.packetsWaitingAck.values())
      clearTimeout(x)
}

export class PacketController {
  constructor(mqttClient, topic, direction) {
    this.openedSockets = new Map()
    this.mqttClient = mqttClient
    this.topic = topic
    this.direction = direction
  }

  init(extractSocketId, portNumber) {
    this.mqttClient.on('message', (incomingTopic, buffer) => {
      const socketId = extractSocketId(incomingTopic)
      const {data, code, packetNumber} = extractHeader(buffer)
      if (code !== PacketCodes.Ack)
        if (code === PacketCodes.Connect || this.openedSockets.has(socketId))
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
      removeSocket(this.openedSockets, socket)
    }, mqttTimeout)
    return socket
  }

  publishToMqtt(socket, code, data = Buffer.alloc(0)) {
    const packetNumber = socket.nextPacketNumber++
    const dataWithHeader = applyHeader(data, code, packetNumber)
    const writeToMqtt = () => {
      if (!this.openedSockets.has(socket.id))
        throw new Error(`This socket is gone ${socket.id} for ${packetNumber}`)

      debug(`${this.direction} ${socket.id}: Sending data ${packetNumber}, code: ${code} to topic ${socket.dataTopic}`)
      this.mqttClient.publish(socket.dataTopic, dataWithHeader, {qos: 1})
      const handle = setTimeout(writeToMqtt, resentPeriod)
      socket.packetsWaitingAck.set(packetNumber, handle)
    }

    if (!socket.packetsWaitingAck)
      socket.packetsWaitingAck = new Map()

    if (socket.packetsWaitingAck.size >= 4)
      socket.pause()

    retryUntil(() => socket.packetsWaitingAck.size < 4, mqttTimeout)
      .then(r => {
        if (r && this.openedSockets.has(socket.id)) {
          socket.resume()
          writeToMqtt()
        }
      }, )

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

  manageSocketEvents(socket, socketId) {
    socket.id = socketId
    this.rescheudleSocketTimeout(socketId)

    socket.on('data', data => {
      debug(`${this.direction} ${socket.id}: received packet ${socket.nextPacketNumber}, containing ${data.length} bytes on socket`)
      this.publishToMqtt(socket, PacketCodes.Data, data)
    })

    socket.on('end', () => {
      this.publishToMqtt(socket, PacketCodes.End)
      info(`${this.direction} ${socket.id}: session ended.`)
      debug(`${this.direction} ${socket.id}: received end signal.  Forwarding to mqtt.`)
    })

    socket.on('close', () => {
      this.publishToMqtt(socket, PacketCodes.Close)
      debug(`${this.direction} ${socket.id}: received close signal.  Forwarding to mqtt.`)
    })
  }

  reset() {
    debug(`${this.direction} Closing all sockets`)
    for (const s of [...this.openedSockets.values()])
      removeSocket(this.openedSockets, s)

    this.openedSockets.clear()
  }

  [PacketCodes.End](socketId, data, packetNumber) {
    this.rescheudleSocketTimeout(socketId)
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${this.direction} ${socketId}: socket end`)
      removeSocket(this.openedSockets, socket)
    })
  }

  [PacketCodes.Close](socketId, data, packetNumber) {
    this.rescheudleSocketTimeout(socketId)
    this.syncPackets(socketId, packetNumber, socket => {
      debug(`${this.direction} ${socketId}: socket close`)
      info(`${this.direction} ${socket.id}: session ended.`)
      removeSocket(this.openedSockets, socket)
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
    const socket = this.rescheudleSocketTimeout(socketId)
    debug(`${this.direction} ${socketId}: received ack for data packet ${packetNumber}`)
    if (socket) {
      const timerHandler = socket.packetsWaitingAck.get(packetNumber)
      clearTimeout(timerHandler)
      socket.packetsWaitingAck.delete(packetNumber)
    }
  }
}
