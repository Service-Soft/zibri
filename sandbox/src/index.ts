import { inject, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication } from "zibri";
import { TestController } from "./controllers/test.controller";

const app = new ZibriApplication({
    name: 'Api',
    controllers: [TestController]
});

export const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);

app.start(3000);