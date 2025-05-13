import { DiContainer } from './di-container';
import { DiToken } from './models';

export function inject<T>(token: DiToken<T>): T {
    const di: DiContainer = DiContainer.getInstance();
    return di.inject(token);
}