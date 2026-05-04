// Import the API version from the package, which mirror Apple's API versioning
import {v1} from 'appstoreconnect'
import {error, info} from '@actions/core'
import fs from 'fs'

type LatestAppVersion = {
  id: string
  version: string
}

type Build = {
  attributes?: {
    version?: string
  }
}

type BuildsResponse = {
  data?: Build[]
  links?: {
    next?: string
  }
}

type BuildNumberResult = {
  buildNumber: string
  buildVersion: string
}

const compareVersionStrings = (left: string, right: string): number =>
  left.localeCompare(right, undefined, {numeric: true, sensitivity: 'base'})

// Initialize the service. Passing the token up-front is optional, but should be done before any API calls are made.

// Compare to https://developer.apple.com/documentation/appstoreconnectapi/list_builds

export class Version {
  private api: ReturnType<typeof v1> | null = null

  public constructor(privateKey: string, issuerId: string, keyId: string) {
    const token = v1.token(privateKey, issuerId, keyId)
    this.api = v1(token)
  }

  getLatestAppVersionId = async (appId: string, platform: string) => {
    const latestVersion = await this.getLatestAppVersion(appId, platform)
    return latestVersion.id
  }

  getLatestAppVersion = async (
    appId: string,
    platform: string
  ): Promise<LatestAppVersion> => {
    if (!this.api) {
      throw new Error('API not initialized')
    }

    try {
      const prereleaseVersions = await v1.testflight.listPrereleaseVersions(
        this.api,
        {
          filter: {
            app: [appId],
            platform: [platform]
          } as never,
          sort: ['-version']
        }
      )

      const latestVersion = [...prereleaseVersions.data]
        .filter(prereleaseVersion => prereleaseVersion.attributes?.version)
        .sort((left, right) =>
          compareVersionStrings(
            right.attributes?.version ?? '',
            left.attributes?.version ?? ''
          )
        )[0]

      if (!latestVersion) {
        throw new Error('No prerelease versions found.')
      }

      return {
        id: latestVersion.id,
        version: latestVersion.attributes?.version ?? ''
      }
    } catch (err) {
      error(
        err instanceof Error
          ? err
          : `Error fetching prerelease versions: ${String(err)}`
      )
      throw err
    }
  }

  getLatestBuildId = async (prereleaseVersionId: string) => {
    if (!this.api) {
      throw new Error('API not initialized')
    }

    try {
      const builds = await this.listBuilds(prereleaseVersionId)

      if (builds.length === 0) {
        throw new Error('No builds found for the specified prerelease version.')
      }

      const versions = builds
        .map(build => build.attributes?.version)
        .filter((version): version is string => Boolean(version))
        .filter(version => /^\d+$/.test(version))
        .sort((left, right) => parseInt(right) - parseInt(left))

      const version = versions[0]

      if (!version) {
        throw new Error('No version found for the latest build.')
      }

      return version
    } catch (err) {
      error(
        err instanceof Error ? err : `Error fetching builds: ${String(err)}`
      )
      throw err
    }
  }

  private listBuilds = async (
    prereleaseVersionId: string
  ): Promise<Build[]> => {
    if (!this.api?.token) {
      throw new Error('API not initialized')
    }

    const builds: Build[] = []
    const url = new URL(`${this.api.baseUrl}/builds`)
    url.searchParams.set('fields[builds]', 'version')
    url.searchParams.set('filter[preReleaseVersion]', prereleaseVersionId)
    url.searchParams.set('sort', '-version')
    url.searchParams.set('limit', '200')

    let nextUrl: string | undefined = url.toString()

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          authorization: `Bearer ${this.api.token}`
        }
      })
      const body = await response.text()

      if (!response.ok) {
        throw new Error(body)
      }

      const json = JSON.parse(body) as BuildsResponse
      builds.push(...(json.data ?? []))
      nextUrl = json.links?.next
    }

    return builds
  }

  buildNumber = async (
    appId: string,
    platform: string,
    projectFilePath: string
  ): Promise<BuildNumberResult> => {
    const latestVersion = await this.getLatestAppVersion(appId, platform)
    info(`Latest version ID: ${latestVersion.id}`)
    info(`Latest version: ${latestVersion.version}`)
    const latestBuildId = await this.getLatestBuildId(latestVersion.id)
    info(`Latest build ID: ${latestBuildId}`)
    const nextBuildNumber = parseInt(latestBuildId) + 1
    info(`Next build number: ${nextBuildNumber}`)
    if (projectFilePath === '') {
      return {
        buildNumber: latestBuildId,
        buildVersion: latestVersion.version
      }
    }
    // Update the build number in the Xcode project file
    const configFilePath = `${projectFilePath}/project.pbxproj`
    const configFile = fs.readFileSync(configFilePath, 'utf8')
    const newConfigFile = configFile.replace(
      /CURRENT_PROJECT_VERSION = \d+;/g,
      `CURRENT_PROJECT_VERSION = ${nextBuildNumber};`
    )
    fs.writeFileSync(configFilePath, newConfigFile, 'utf8')
    info(`Updated build number to ${nextBuildNumber} in ${configFilePath}`)
    return {
      buildNumber: latestBuildId,
      buildVersion: latestVersion.version
    }
  }
}
