import { $ts, Auth, Controller, Get, GlobalRegistry, ServiceUnavailableError } from 'zibri';

@Auth.skip({ allowRedundant: true })
@Controller('/health', { versions: 'all' })
export class HealthController {

    @Get('/live')
    live(): { status: string } {
        return { status: 'ok' };
    }

    @Get('/ready')
    ready(): { status: string } {
        if (!GlobalRegistry.isAppStarted()) {
            throw new ServiceUnavailableError($ts`This instance is shutting down.`);
        }
        return { status: 'ok' };
    }
}