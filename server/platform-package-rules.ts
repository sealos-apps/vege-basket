import type { PackageMarketRule } from './package-market.ts'
import { parsePackageMarketRulesYaml } from './package-market.ts'
import { getPlatformConfigByRevision } from './platform-config-store.ts'

export async function getPackageMarketRulesForConfigRevision(
  revision: number | null,
): Promise<PackageMarketRule[] | undefined> {
  if (revision === null) return undefined
  const version = await getPlatformConfigByRevision(revision)
  if (!version) throw new Error(`Platform configuration revision ${revision} was not found`)
  return parsePackageMarketRulesYaml(
    version.config.packages.rulesYaml,
    version.config.packages.legacyMiddlewareRoots,
  )
}
