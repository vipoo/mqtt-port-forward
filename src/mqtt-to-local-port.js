import net from 'net'
import _debug from 'debug'
import {PacketCodes} from './lib/buffer-management'
import {PacketController} from './lib/packet-controller'

const info = _debug('mqtt:pf:info')

class Controllers extends PacketController {
  [PacketCodes.Connect](socketId, data, packetNumber, portNumber) {
    const socket = new net.Socket()
    info(`${socketId}: out Establishing connection to local port ${portNumber}`)
    socket.connect(portNumber, '127.0.0.1', () => {
      socket.nextIncomingPacket = packetNumber + 1
    })

    socket.id = socketId
    socket.nextPacketNumber = 1
    socket.nextIncomingPacket = packetNumber
    this.openedSockets.set(socketId, socket)

    socket.dataTopic = `${this.topic}/tunnel/down/${socketId}`
    this.manageSocketEvents(socket, socketId)
  }
}

export async function forwardMqttToLocalPort(mqttClient, portNumber, topic) {
  const socketIdPattern = new RegExp(`^${topic}/tunnel/up/(.*)$`)
  const extractSocketId = str => socketIdPattern.exec(str)[1]

  const controllers = new Controllers(mqttClient, topic, 'up')
  await controllers.init(extractSocketId, portNumber)

  mqttClient.on('connect', () => {
    info(`Listening on mqtt topics ${topic}/tunnel/* to forward to port ${portNumber}`)
  })
  return () => controllers.reset()
}
