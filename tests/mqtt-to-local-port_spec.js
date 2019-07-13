import {when, then, expect, sinon, eventually} from './test_helper'
import {forwardMqttToLocalPort} from '../src'
import EventEmitter from 'events'
import net from 'net'
import {PacketCodes, applyHeader} from '../src/lib/buffer-management'

const resetPacket = Buffer.from([0, 0, 0, PacketCodes.Reset, 0, 0, 0, 0])
const connectPacket = Buffer.from([0, 0, 0, PacketCodes.Connect, 0, 0, 0, 1])

const dataPacket = (content, number) => applyHeader(Buffer.from(content), PacketCodes.Data, number)
const endPacket = number => applyHeader(Buffer.alloc(0), PacketCodes.End, number)
const closePacket = number => applyHeader(Buffer.alloc(0), PacketCodes.Close, number)

when('forwardMqttToLocalPort is invoked', () => {

  let onSocketData
  let onSocketEnd
  let onSocketClose
  let server
  let mqttClient
  let capturedSockets
  let socketCreated

  beforeEach(() => {
    capturedSockets = []
    onSocketData = sinon.stub()
    onSocketEnd = sinon.stub()
    onSocketClose = sinon.stub()
    socketCreated = sinon.stub()
    mqttClient = new EventEmitter()
    mqttClient.subscribe = sinon.stub()
    mqttClient.publish = sinon.stub()
    forwardMqttToLocalPort(mqttClient, 14567, 'testtopic')

    server = net.createServer({allowHalfOpen: true}, socket => {
      socketCreated()
      capturedSockets.push(socket)
      socket.on('data', onSocketData)
      socket.on('end', onSocketEnd)
      socket.on('close', onSocketClose)
    })
    server.listen(14567, '127.0.0.1', () => {})

  })

  afterEach(() => {
    server.close()
    capturedSockets.forEach(s => s.destroy())
  })

  then('a reset signal is sent to the mqtt topic', () =>
    expect(mqttClient.publish).to.have.been.calledWith('testtopic/tunnel/down/0', resetPacket))

  when('mqtt topic receives a connection message', () => {
    beforeEach(() => mqttClient.emit('message', 'testtopic/tunnel/up/1', connectPacket))

    then('a socket connection has been established', () =>
      eventually(() => expect(socketCreated).to.have.been.calledOnce))

    when('mqtt topic receives a data packet', () => {
      beforeEach(() => mqttClient.emit('message', 'testtopic/tunnel/up/1', dataPacket('blah', 2)))

      then('the data is received on the socket', () =>
        eventually(() => expect(onSocketData).to.have.been.calledWith(Buffer.from('blah'))))

      when('mqtt topic receives an end signal', () => {
        beforeEach(() => mqttClient.emit('message', 'testtopic/tunnel/up/1', endPacket(3)))

        then('the local socket is closed', () =>
          eventually(() => expect(onSocketEnd).to.have.been.calledOnce))
      })

      when('mqtt topic receives an close signal', () => {
        beforeEach(() => mqttClient.emit('message', 'testtopic/tunnel/up/1', closePacket(3)))

        then('the local socket is closed', () =>
          eventually(() => expect(onSocketEnd).to.have.been.calledOnce))
      })
    })
  })
})
