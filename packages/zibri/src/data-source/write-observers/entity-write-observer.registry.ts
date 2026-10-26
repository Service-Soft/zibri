import { EntityWriteObserver } from './entity-write-observer.model';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { LifecyclePhase } from '../../global/lifecycle-phase.enum';
import { Newable } from '../../types/newable.type';

/**
 * Holds the observers of every entity, which every write to it reaches, registered by the services
 * whose rules they are while the application starts.
 */
@Injectable({ register: 'onUse' })
export class EntityWriteObserverRegistry {
    // a provider of each application rather than a static registry: an observer belongs to the
    // service instances of the application that registered it. Not behind a token: it is how the
    // framework's subsystems follow each other's writes (09 §Q6), and what an application hears of
    // writes is 06 §Q4's question
    private readonly observers: Map<Newable<BaseEntity>, EntityWriteObserver[]> = new Map();

    /**
     * Registers an observer of every write to an entity, from `onAppInit` or `afterAppInit`.
     * @param entityClass - The entity.
     * @param observer - The observer.
     * @throws An InternalError once `afterAppInit` has finished, since writes made before would not
     * have reached it.
     */
    register(entityClass: Newable<BaseEntity>, observer: EntityWriteObserver): void {
        // the drivers keep what they found once afterAppInit has finished, so this is what keeps them
        // right. Until then, since a service observing the entities of another finds them only once
        // that one's onAppInit has run, in an order nobody chose
        if (GlobalRegistry.isLifecyclePhaseFinished(LifecyclePhase.AFTER_APP_INIT)) {
            throw new InternalError(`An observer of ${entityClass.name} is registered after afterAppInit, where writes have been made without it.`);
        }
        this.observers.set(entityClass, [...this.findObservers(entityClass), observer]);
    }

    /**
     * Finds the observers of an entity.
     * @param entityClass - The entity.
     * @returns The observers, in the order they were registered.
     */
    findObservers(entityClass: Newable<BaseEntity>): EntityWriteObserver[] {
        return this.observers.get(entityClass) ?? [];
    }
}
