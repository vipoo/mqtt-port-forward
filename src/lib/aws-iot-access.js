import {AWSP} from './aws'
import assumeRolePolicyDocument from './assume-role-policy-document'

const region = process.env.AWS_REGION || 'ap-southeast-2'
const Iot = new AWSP('Iot', {region, apiVersion: '2015-05-28'})
const Iam = new AWSP('IAM', {region, apiVersion: '2010-05-08'})
const sts = new AWSP('STS', {region, apiVersion: '2011-06-15'})

const reg = /cert\/(.*)/
const fromArnToId = certificateArn => reg.exec(certificateArn)[1]

async function getAccountId() {
  const {Account} = await sts.getCallerIdentity()
  return Account
}

const _log = {
  info: (...args) => console.log(...args), // eslint-disable-line no-console
}

export class AwsIotAccess {
  constructor(options) {
    options = {log: _log, ...options}
    this.log = options.log
    this.name = options.topicName
  }

  async configureRoleIdentities() {
    const RoleName = `mqtt-pf-${this.name}`
    const Description = 'role created by mqtt-port-forward cli to access topics'
    const Tags = [{Key: 'mqtt-port-forward', Value: 'mqtt-port-forward'}]
    const AssumeRolePolicyDocument = assumeRolePolicyDocument

    const {Role} = await Iam.createRole({RoleName, Description, Tags, AssumeRolePolicyDocument})
      .catch(err => err.code === 'EntityAlreadyExists' ? Iam.getRole({RoleName}) : err)

    const roleArn = Role.Arn
    const roleAlias = `${RoleName}-iot-role-alias`

    const retrieve = () => Iot.describeRoleAlias({roleAlias})
      .then(() => this.log.info(`Role exists: 'mqtt-pf-${this.name}' with iot alias of '${RoleName}-iot-role-alias'`))

    await Iot.createRoleAlias({roleAlias, roleArn})
      .then(() => this.log.info(`Created role 'mqtt-pf-${this.name}' with iot alias of '${RoleName}-iot-role-alias'`))
      .catch(err => err.code === 'ResourceAlreadyExistsException' ? retrieve() : err)
  }

  async deleteRoleIdentities() {
    const RoleName = `mqtt-pf-${this.name}`
    const roleAlias = `${RoleName}-iot-role-alias`

    await Iot.deleteRoleAlias({roleAlias})
      .catch(err => err.code === 'ResourceNotFoundException' ? undefined : err)
    await Iam.deleteRole({RoleName})
      .catch(err => err.code === 'NoSuchEntity' ? undefined : err)
  }

  async configureIotAccess() {
    const roleAlias = `mqtt-pf-${this.name}-iot-role-alias`
    const policyExists = await Iot.getPolicy({policyName: this.name}).catch(() => false)
    if (policyExists)
      await this.updatePolicyVersion(roleAlias)
    else
      return await this.createCertificateAndAssociatePolicy(roleAlias)
  }

  async deleteIotAccess() {
    await this.deletePolicyVersions()

    const {principals} = await Iot.listPolicyPrincipals({policyName: this.name})

    if (principals.length > 1)
      throw new Error(`Unexpected additional certificates found for policy: ${this.name}`)

    if (principals.length === 1) {
      const principal = principals[0]
      const certificateId = fromArnToId(principal)
      await Iot.detachPrincipalPolicy({policyName: this.name, principal})
      this.log.info(`Detached certificate from policy '${this.name}'`)
      await Iot.updateCertificate({certificateId, newStatus: 'INACTIVE'})
      await Iot.deleteCertificate({certificateId})
      this.log.info('Deleted certificate')
    }

    await Iot.deletePolicy({policyName: this.name})
      .then(() => this.log.info(`Removed policy '${this.name}'`))
      .catch(err => err.code === 'ResourceNotFoundException' ? undefined : err)
  }

  async deletePolicyVersions() {
    const {policyVersions} = await Iot.listPolicyVersions({policyName: this.name})
      .catch(err => err.code === 'ResourceNotFoundException' ? {policyVersions: []} : err)

    for (const v of policyVersions.filter(p => !p.isDefaultVersion)) {
      await Iot.deletePolicyVersion({policyName: this.name, policyVersionId: v.versionId})
      this.log.info(`Removing from policy '${this.name}', document version number: ${v.versionId}`)
    }
  }

  async updatePolicyVersion(roleAliasName) {
    const accountId = await getAccountId()
    await this.deletePolicyVersions()
    const {policyVersionId} = await Iot.createPolicyVersion({policyName: this.name, policyDocument: policyDocument(accountId, region, this.name, roleAliasName), setAsDefault: true})
    this.log.info(`Attached to policy '${this.name}', a new default document number: ${policyVersionId}`)
    await this.deletePolicyVersions()
  }

  async  createCertificateAndAssociatePolicy(roleAliasName) {
    const accountId = await getAccountId()

    await Iot.createPolicy({policyName: this.name, policyDocument: policyDocument(accountId, region, this.name, roleAliasName)})
    this.log.info(`Created a new policy '${this.name}', with default document number: 1`)

    const {certificateArn, certificatePem, keyPair} = await Iot.createKeysAndCertificate({setAsActive: true})
    this.log.info('Created an active certificate')
    const privateKey = keyPair.PrivateKey

    await Iot.attachPrincipalPolicy({policyName: this.name, principal: certificateArn})
    this.log.info(`Attached certificate to policy'${this.name}'`)

    return {privateKey, certificatePem}
  }
}

const policyDocument = (accountId, region, policyName, roleAliasName) => JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: [
        'iot:AssumeRoleWithCertificate'
      ],
      Resource: [
        `arn:aws:iot:${region}:${accountId}:rolealias/${roleAliasName}`
      ]
    },
    {
      Effect: 'Allow',
      Action: [
        'iot:Connect'
      ],
      Resource: [
        '*'
      ]
    },
    {
      Effect: 'Allow',
      Action: [
        'iot:Subscribe',
        'iot:Receive',
        'iot:Publish'
      ],
      Resource: [
        `arn:aws:iot:${region}:${accountId}:topicfilter/${policyName}/tunnel/*`,
        `arn:aws:iot:${region}:${accountId}:topic/${policyName}/tunnel/*`
      ]
    }
  ]
})
