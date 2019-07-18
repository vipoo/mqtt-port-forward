import {AwsIotAccess} from '../src/lib/aws-iot-access'
import {createMqttClient} from '../src/lib/mqtt'
import ca from '../src/lib/amazon-root-ca1-pem'
import net from 'net'
import {AWSP} from '../src/lib/aws'

const region = process.env.AWS_REGION || 'ap-southeast-2'
const Iot = new AWSP('Iot', {apiVersion: '2015-05-28', region})

let getAwsIotEndPoint = async () => {
  const result = await Iot.describeEndpoint({endpointType: 'iot:Data-ATS'})
  const endpoint = result.endpointAddress
  getAwsIotEndPoint = () => endpoint
  return endpoint
}

export async function recreateAwsAccess(topicName) {
  const access = new AwsIotAccess({topicName})
  await access.deleteIotAccess()
  await access.deleteRoleIdentities()
  await access.configureRoleIdentities()
  const keys = await access.configureIotAccess()

  const endpoint = await getAwsIotEndPoint()

  const mqttOptions = {
    debug: true,
    qos: 1,
    keepalive: 60,
    key: keys.privateKey,
    cert: keys.certificatePem,
    ca,
    host: endpoint
  }

  const clientOut = await createMqttClient({...mqttOptions, clientId: `${topicName}-out`})
  const clientIn = await createMqttClient({...mqttOptions, clientId: `${topicName}-in`})

  const end = async () => {
    clientIn.end()
    clientOut.end()
    await access.deleteIotAccess()
    await access.deleteRoleIdentities()
  }

  return {mqttOptions, end, clientOut, clientIn}
}

export async function createEchoServer(port) {
  let capturedSocket
  const echoServer = net.createServer(socket => {
    capturedSocket = socket
    socket.on('data', d => {
      socket.write(`echo ${d}`)
      socket.end()
      socket.destroy()
    })
  })

  await new Promise(res => echoServer.listen(port, '127.0.0.1', res))

  const end = () => {
    if (capturedSocket)
      capturedSocket.destroy()
    echoServer.close()
  }

  return {end}
}

export function createClientSocket(fnData) {
  const clientSocket = new net.Socket()
  clientSocket.on('data', d => fnData(d.toString()))

  const end = () => {
    clientSocket.end()
    clientSocket.destroy()
  }

  return {
    end,
    connect: (...args) => clientSocket.connect(...args),
    write: (...args) => clientSocket.write(...args)
  }
}
