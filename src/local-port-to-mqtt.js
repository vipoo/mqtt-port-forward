import net from 'net'
import _debug from 'debug'
import {PacketCodes} from './lib/buffer-management'
import {PacketController} from './lib/packet-controller'
import {generateId} from './lib/id-generator'

const info = _debug('mqtt:pf:info')

class Controllers extends PacketController {
  connect(socket) {
    const socketId = generateId()
    info(`${socketId}: starting new session`)
    socket.id = socketId
    socket.nextPacketNumber = 1
    socket.nextIncomingPacket = 1
    this.openedSockets.set(socketId, socket)
    socket.dataTopic = `${this.topic}/tunnel/up/${socketId}`
    this.publishToMqtt(socket, PacketCodes.Connect)
    this.manageSocketEvents(socket)
  }

  [PacketCodes.Connect]() {
    throw new Error('local-port-to-mqtt should not have recieved connect msg')
  }
}

export async function forwardLocalPortToMqtt(mqttClient, portNumber, topic) {
  const socketIdPattern = new RegExp(`^${topic}/tunnel/down/(.*)$`)
  const extractSocketId = str => socketIdPattern.exec(str)[1]

  const controllers = new Controllers(mqttClient, topic, 'down')
  controllers.init(extractSocketId, portNumber)

  const server = net.createServer({allowHalfOpen: true}, socket =>
    controllers.connect(socket))

  await new Promise(res =>
    server.listen(portNumber, '127.0.0.1', () => {
      info(`Listening on ${portNumber} to forward to mqtt topics`)
      res()
    }))

  return () => {
    server.close()
    controllers.reset()
  }
}
