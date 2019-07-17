import AWS from 'aws-sdk'

export const region = process.env.AWS_REGION || 'ap-southeast-2'
export const sessionToken = process.env.AWS_SESSION_TOKEN

AWS.config.apiVersions = {
  iot: '2015-05-28',
  iam: '2010-05-08',
  sts: '2011-06-15'
}

AWS.config.update({region})

function promiseAlways(name) {
  return function(params) {
    const module = new AWS[name]({...params})
    for (const x of Object.getOwnPropertyNames(Object.getPrototypeOf(module)))
      this[x] = function() { return module[x](...arguments).promise() }
  }
}

export const Iot = promiseAlways('Iot')
export const IAM = promiseAlways('IAM')
export const STS = promiseAlways('STS')
const iot = new Iot()

export let getAwsIotEndPoint = async () => {
  const result = await iot.describeEndpoint({endpointType: 'iot:Data-ATS'})
  const endpoint = result.endpointAddress
  getAwsIotEndPoint = () => endpoint
  return endpoint
}

export default {AWS, getAwsIotEndPoint, Iot, IAM, STS, region}
