import { CatalyxApplication } from "catalyx";
import { TestService } from "./services/test.service";

const app = new CatalyxApplication();

app.start(3000);

app.di.register({ token: '42', useFactory: () => 42 });
console.log('catalyx app started')
console.log('dependency injection:\n', app.di.inject(TestService));