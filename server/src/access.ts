import type { Principal } from './auth.js'
import type { AclRole, DocRow } from './db/types.js'

/**
 * Role model (§7.2 of the contract). Effective role on a doc =
 * max(owner, ACL entry for the caller's account email, link_access), where
 * merely presenting the doc id earns `link_access`.
 */
export type Role = 'none' | 'viewer' | 'editor' | 'owner'

const RANK: Record<Role, number> = { none: 0, viewer: 1, editor: 2, owner: 3 }

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min]
}

/**
 * Compute the caller's effective role. `aclRole` is the caller's ACL entry
 * looked up by account email (null when absent or when the caller has no email).
 * `principal` may be null for unauthenticated signaling sockets.
 *
 * `emailSharingEnabled` gates the per-email ACL contribution. When false the ACL
 * entry is ignored entirely — so even a pre-existing `(doc,email)` row grants
 * nothing. Owner and link-access are unaffected.
 */
export function effectiveRole(
  doc: Pick<DocRow, 'owner' | 'linkAccess'>,
  principal: Principal | null,
  aclRole: AclRole | null,
  emailSharingEnabled: boolean,
): Role {
  if (principal && doc.owner !== null && doc.owner === principal.key) return 'owner'
  let best: Role = 'none'
  // SECURITY(H2): unverified-email squatting — the ACL-by-email grant is only
  // honored when email sharing is enabled; it stays off until email verification
  // lands. See contract §7 / §7.2. Do not honor `aclRole` when the flag is off.
  if (emailSharingEnabled && aclRole && RANK[aclRole] > RANK[best]) best = aclRole
  if (doc.linkAccess !== 'none' && RANK[doc.linkAccess] > RANK[best]) best = doc.linkAccess
  return best
}
