import {getInput, setFailed, setOutput} from '@actions/core'
import {Version} from './testflight'

async function run(): Promise<void> {
  try {
    const appId: string = getInput('app-id')
    const platform: string = getInput('platform')
    const projectPath: string = getInput('project-path')
    const apiKeyId = getInput('api-key-id')
    const apiPrivateKey = getInput('api-private-key')
    const issuerId = getInput('issuer-id')
    const version = new Version(apiPrivateKey, issuerId, apiKeyId)
    const currentBuild = await version.buildNumber(
      appId,
      platform,
      projectPath
    )
    setOutput('build-number', currentBuild.buildNumber)
    setOutput('build-version', currentBuild.buildVersion)
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    }
  }
}

run()
