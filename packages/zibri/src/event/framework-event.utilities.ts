import { type EventServiceInterface, ZibriEventMap } from './event-service.interface';
import { type EventTypeFor } from './event-type-for.type';
import { AlsUtilities } from '../context/als.utilities';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';

/**
 * Emits the writes of the framework's own as the events an application named for them.
 */
export class FrameworkEventUtilities {
    /**
     * Emits a write as the event an application named for it, in the tenant it is about.
     * @param type - The type the application named.
     * @param data - What the event carries.
     * @param tenantId - The tenant the write is about, null for none, which emits it outside every
     * tenant whichever the write was made in.
     */
    static async emit<Data extends object>(type: EventTypeFor<Data>, data: Data, tenantId: string | null): Promise<void> {
        const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        // the type was chosen for a payload the data fits, which `EventTypeFor` checked where the
        // application named it. The map is open, so that cannot be carried into emit's signature
        const emit: () => Promise<void> = async () => await eventService.emit(type, data as ZibriEventMap[EventTypeFor<Data>]);
        if (tenantId == undefined) {
            await AlsUtilities.runOutsideTenant(emit);
            return;
        }
        await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, emit);
    }
}
