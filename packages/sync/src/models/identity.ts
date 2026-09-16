/** The host authenticates the actor and authorizes access to this owner. */
export interface Scope {
  actorId: string;
  ownerId: string;
}
export interface Resource extends Scope {
  id: string;
}
export function workerScope(ownerId: string): Scope {
  return { actorId: 'open-sync:worker', ownerId };
}
