/**
 * Role sync planning (pure logic, no Discord calls) so it can be tested on its own.
 *
 * Rules from docs/SPEC.md: Cortana is the source of truth and Discord mirrors it, and the
 * bot "only touches roles listed in the database, so hand-made community and notification
 * roles are never removed".
 */
export interface RolePlan {
  add: string[];
  remove: string[];
  /** The member's complete role list after the change (unmanaged roles untouched). */
  final: string[];
}

export function planRoles(current: Iterable<string>, desired: readonly string[], managed: readonly string[]): RolePlan {
  const have = new Set(current);
  const want = new Set(desired);
  const isManaged = new Set([...managed, ...desired]);

  const add = [...want].filter((r) => !have.has(r));
  const remove = [...have].filter((r) => isManaged.has(r) && !want.has(r));
  const removeSet = new Set(remove);
  const final = [...[...have].filter((r) => !removeSet.has(r)), ...add];

  return { add, remove, final };
}

export function isNoop(plan: RolePlan): boolean {
  return plan.add.length === 0 && plan.remove.length === 0;
}
