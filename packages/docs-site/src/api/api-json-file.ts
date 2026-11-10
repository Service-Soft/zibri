import path from 'node:path';

// what typedoc reads from the sources of zibri, which the build of zibri writes (`npm run build:prod -w zibri`)
export const API_JSON_FILE: string = path.join(process.cwd(), '..', 'zibri', 'docs', '.generated', 'api.json');