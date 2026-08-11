import type { Env } from './env.js'
import type { DocRepo, Usage } from './db/types.js'

/**
 * Quotas (§7.3): per-principal doc count + total stored bytes, limits from env.
 * Bytes are the sum of committed snapshot sizes (`docs.size_bytes`) per owner.
 * The per-PUT 5 MB cap is separate (route bodyLimit → 413).
 */

export interface QuotaLimits {
  docs: number
  bytes: number
}

export interface UsageReport extends Usage {
  limits: QuotaLimits
}

/** Limits keyed off the owning principal's kind (`user:` vs `device:`). */
export function limitsFor(env: Env, ownerKey: string): QuotaLimits {
  return ownerKey.startsWith('user:')
    ? { docs: env.QUOTA_ACCOUNT_DOCS, bytes: env.QUOTA_ACCOUNT_BYTES }
    : { docs: env.QUOTA_DEVICE_DOCS, bytes: env.QUOTA_DEVICE_BYTES }
}

export async function usageReport(repo: DocRepo, env: Env, ownerKey: string): Promise<UsageReport> {
  const usage = await repo.getUsage(ownerKey)
  return { ...usage, limits: limitsFor(env, ownerKey) }
}

/**
 * Would adding `newDocs` docs and `deltaBytes` stored bytes push `ownerKey`
 * over its limits? Returns null when within quota, otherwise the ready-to-send
 * `403 {error:"quota_exceeded", usage}` payload. Shrinking writes always pass.
 */
export async function checkQuota(
  repo: DocRepo,
  env: Env,
  ownerKey: string,
  delta: { newDocs: number; deltaBytes: number },
): Promise<{ error: 'quota_exceeded'; usage: UsageReport } | null> {
  const usage = await usageReport(repo, env, ownerKey)
  const overDocs = usage.docs + delta.newDocs > usage.limits.docs
  const overBytes = delta.deltaBytes > 0 && usage.bytes + delta.deltaBytes > usage.limits.bytes
  if (!overDocs && !overBytes) return null
  return { error: 'quota_exceeded', usage }
}
