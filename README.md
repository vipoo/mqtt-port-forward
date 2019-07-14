# MQTT Port Forwarding
-----------

[![Build Status](https://travis-ci.com/vipoo/mqtt-port-forward.svg?branch=master)](https://travis-ci.com/vipoo/mqtt-port-forward)

This modules provides a means to forward a tcp socket, over MQTT to another mqtt recipient

It can be integrated into your mqtt iot devices, to allow estabishing a secure ssh connection
from your support laptop to a specific remote iot device.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Example](#example)
- [License](#license)


## Install

```sh
$ npm install mqtt-port-formward
```

## Usage

This package, exports 2 functions to establish the port forwarding.

`forwardLocalPortToMqtt` - To listen on a specific port, and forward connection requests to a specific mqtt topic

`forwardMqttToLocalPort` - To accept connection request over mqtt topic, and forward to a specific local port on 127.0.0.1

## API Documentation

The package exports 2 functions

* [forwardMqttToLocalPort()](#forwardmqtttolocalportmqttclient-portnumber-topic)
* [forwardLocalPortToMqtt()](#forwardlocalporttomqttmqttclient-portnumber-topic)

### forwardMqttToLocalPort(mqttClient, portNumber, topic, timeoutPeriod = 120000)

Subscribes on the supplied `mqttClient` object, to the topic pattern `<topic>/tunnel/up/+`.

When a new connection request is received on this topic, a socket connection is established
on `portNumber` to the localhost.  Assumes there is a service ready to accept this connection.

Once connection is establish, data received on topic `<topic>/tunnel/up/+` will be sent to
the socket, and data sent from the socket will be published to mqtt topic `<topic>/tunnel/down/+`

If the `mqttClient` object is closed, then any opened sockets will be closed.

If no traffic is received on the mqtt topic for `timeoutPeriod`, then all sockets will be closed.

### forwardLocalPortToMqtt(mqttClient, portNumber, topic)

Established a local socket listener on `portNumber`.  When connections are established,
the connection and data are forward to mqtt topic `<topic>/tunnel/down/+`

It also uses the supplied `mqttClient` object to subscribe and listen for messages
on topic `<topic>/tunnel/up/+` to return back to the local socket.


## Example

If you have a device, you wish to be able to establish a ssh connection with,
over mqtt, you first need to use `forwardMqttToLocalPort`.  This function will subscribe
to a specific topic, and forward connections to a local ssh server running on your device.

This will need to be paried with the `forwardLocalPortToMqtt` running on another device.  This function
will establish a service for a specific port, and upon receiving connections/data, forward that to the appropriate device's topic

On your device, you first need a mqtt connection object - you can use the standard [mqtt library](https://github.com/mqttjs/MQTT.js)
or if you are using AWS [aws-iot-device-sdk-js](https://github.com/aws/aws-iot-device-sdk-js)

Once you have created your mqttClient object, you can then invoke the `forwardMqttToLocalPort` function

```
  import {forwardMqttToLocalPort} from 'mqtt-port-forward'

  // Forward requests received on mqtt topic 'mydevicessh/tunnel/down/+'
  forwardMqttToLocalPort(mqttClient, 22, 'mydevice')

```

Then on the client device (eg: your laptop)

```
  import {forwardMqttToLocalPort} from 'mqtt-port-forward'

  // Listen on localhost:2222 for connection requests and forward to 'mydevice/tunnel/down/+'
  forwardLocalPortToMqtt(mqttClient, 2222, 'mydevicessh')
```

You will need to ensure your 2 connections are authorised to send and received on
the topics `<topic>/tunnel/down/+` and `<topic/tunnel/up/+>`


## License

[MIT](LICENSE) © Dean Netherton
