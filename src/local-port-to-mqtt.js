import net from 'net'
import _debug from 'debug'
import {PacketCodes} from './lib/buffer-management'
import {PacketController} from './lib/packet-controller'

const debug = _debug('mqtt:pf')

class Controllers extends PacketController {
  connect(socket) {
    const socketId = this.nextSocketId++
    debug(`${socketId}: starting new session`)
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

export function forwardLocalPortToMqtt(mqttClient, portNumber, topic) {
  const socketIdPattern = new RegExp(`^${topic}/tunnel/down/(\\d*)$`)
  const extractSocketId = str => parseInt(socketIdPattern.exec(str)[1])

  const controllers = new Controllers(mqttClient, topic)
  controllers.init(extractSocketId, portNumber, 'down')

  const server = net.createServer({allowHalfOpen: true}, socket =>
    controllers.connect(socket))

  server.listen(portNumber, '127.0.0.1',
    () => debug(`Listening on ${portNumber} to forward to mqtt topics`))

  return () => {
    server.close()
    controllers.reset()
  }
}
