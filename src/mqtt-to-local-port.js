import net from 'net'
import _debug from 'debug'
import {PacketCodes} from './lib/buffer-management'
import {PacketController} from './lib/packet-controller'

const info = _debug('mqtt:pf:info')

class Controllers extends PacketController {
  [PacketCodes.Connect](socketId, data, packetNumber, portNumber) {
    const socket = new net.Socket()
    socket.id = socketId
    socket.nextPacketNumber = 1
    socket.nextIncomingPacket = packetNumber + 1
    this.openedSockets.set(socketId, socket)

    socket.dataTopic = `${this.topic}/tunnel/down/${socketId}`
    this.manageSocketEvents(socket)

    info(`${socketId}: out Establishing connection to local port ${portNumber}`)
    socket.connect(portNumber, '127.0.0.1')
  }
}

export async function forwardMqttToLocalPort(mqttClient, portNumber, topic) {
  const socketIdPattern = new RegExp(`^${topic}/tunnel/up/(.*)$`)
  const extractSocketId = str => socketIdPattern.exec(str)[1]

  const controllers = new Controllers(mqttClient, topic, 'up')
  controllers.init(extractSocketId, portNumber)

  return await new Promise(res =>
    mqttClient.on('connect', () => {
      info(`Listening on mqtt topics ${topic}/tunnel/* to forward to port ${portNumber}`)
      res()
    }))
}
