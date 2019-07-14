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

    info(`${socketId}: Establishing connection to local port ${portNumber}`)
    socket.connect(portNumber, '127.0.0.1')
  }
}

let timeoutHandle
function rescheuleTimeoutMonitor(controllers, timeoutPeriod) {
  clearTimeout(timeoutHandle)
  timeoutHandle = setTimeout(() => {
    info('Timeout due to no mqtt packets received.  Terminating all socket connections')
    controllers.reset()
  }, timeoutPeriod)
}

const twoMinutes = 120000
export function forwardMqttToLocalPort(mqttClient, portNumber, topic, timeoutPeriod = twoMinutes) {
  const socketIdPattern = new RegExp(`^${topic}/tunnel/up/(.*)$`)
  const extractSocketId = str => socketIdPattern.exec(str)[1]

  const controllers = new Controllers(mqttClient, topic)
  controllers.init(extractSocketId, portNumber, 'up')

  mqttClient.on('packetreceive', ({cmd}) => cmd === 'publish' ? rescheuleTimeoutMonitor(controllers, timeoutPeriod) : null)

  mqttClient.on('connect', () => info(`Listening on mqtt topics ${topic}/tunnel/* to forward to port ${portNumber}`))
}
