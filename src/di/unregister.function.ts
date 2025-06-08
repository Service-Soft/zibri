import { GlobalRegistry } from '../global';
import { DiContainer } from './di-container';
import { DiToken } from './models';

export function unregister<T>(token: DiToken<T>): void {
    if (GlobalRegistry.isAppInitialized() || GlobalRegistry.isAppRunning()) {
        throw new Error('You can only unregister providers before the app has been initialized');
    }
    const di: DiContainer = DiContainer.getInstance();
    di.unregister(token);
}