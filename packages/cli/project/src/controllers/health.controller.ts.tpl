import { $ts, Auth, Controller, Get, GlobalRegistry, ServiceUnavailableError } from 'zibri';

{{! a probe must answer the same way whatever posture the application takes, and this one is shipped
    into a project that is invited to switch its default to "isLoggedIn" }}
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
