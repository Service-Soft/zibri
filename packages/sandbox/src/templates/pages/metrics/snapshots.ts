import { createContext, MetricsSnapshot, RenderContext } from 'zibri';

/**
 * The snapshots the metrics page loaded, which its charts and cards show.
 */
export const Snapshots: RenderContext<MetricsSnapshot[]> = createContext<MetricsSnapshot[]>([]);
