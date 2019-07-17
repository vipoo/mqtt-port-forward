import {when, then, expect, sinon, eventually} from './test_helper'
import {forwardLocalPortToMqtt} from '../src'
import EventEmitter from 'events'
import net from 'net'
import {PacketCodes, applyHeader} from '../src/lib/buffer-management'
import * as idGeneratorModule from '../src/lib/id-generator'

const connectPacket = Buffer.from([0, 0, 0, PacketCodes.Connect, 0, 0, 0, 1])

const dataPacket = (content, number) => applyHeader(Buffer.from(content), PacketCodes.Data, number)
const endPacket = number => applyHeader(Buffer.alloc(0), PacketCodes.End, number)

when('forwardLocalPortToMqtt is invoked', () => {

  let mqttClient
  let stopServer
  beforeEach(async () => {
    sinon.stub(idGeneratorModule, 'generateId').returns(1)
    mqttClient = new EventEmitter()
    mqttClient.subscribe = sinon.stub()
    mqttClient.publish = sinon.stub()
    stopServer = await forwardLocalPortToMqtt(mqttClient, 14567, 'testtopic')
  })

  afterEach(() => stopServer())

  when('a service connects, writes and closes', () => {
    beforeEach(() => {
      const socket = new net.Socket()
      socket.connect(14567, '127.0.0.1')
      socket.on('error', () => {})
      socket.end('some data', () => socket.destroy())
    })

    then('a connect request is sent to the mqtt topic', () =>
      eventually(() =>
        expect(mqttClient.publish).to.have.been
          .calledWith('testtopic/tunnel/up/1', connectPacket, {qos: 1})))

    then('the data is sent to the mqtt topic', () =>
      eventually(() =>
        expect(mqttClient.publish).to.have.been
          .calledWith('testtopic/tunnel/up/1', dataPacket('some data', 2), {qos: 1})))

    it('the end signal is sent to mqtt topic', () =>
      eventually(() =>
        expect(mqttClient.publish).to.have.been
          .calledWith('testtopic/tunnel/up/1', endPacket(3), {qos: 1})))
  })
})
