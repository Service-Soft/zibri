/**
 * How often a piece of queued work runs when an instance stops at the wrong moment.
 *
 * - `'atLeastOnce'`: it runs again until an attempt is recorded, so an attempt can be repeated.
 * - `'atMostOnce'`: the attempt is recorded as failed before it runs, so it is never repeated, and
 * an instance stopping during it leaves it failed.
 * - `'transactional'`: it runs in a transaction that also records it, so its writes in that data
 * source happen once, and are rolled back with an attempt that fails.
 */
export type QueueDelivery = 'atLeastOnce' | 'atMostOnce' | 'transactional';