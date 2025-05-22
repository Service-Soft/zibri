import { inject, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication } from "zibri";
import { TestController } from "./controllers";
import { DbDataSource } from "./data-sources";

export let logger: LoggerInterface;

async function start(): Promise<void> {
    const app = new ZibriApplication({
        name: 'Api',
        controllers: [TestController],
        dataSources: [DbDataSource]
    });
    await app.init();

    logger = inject(ZIBRI_DI_TOKENS.LOGGER);

    app.start(3000);
}

void start();