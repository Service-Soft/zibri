import { Injectable } from "catalyx";
import { DepService } from "./dep.service";

@Injectable()
export class TestService {
    name: string;
    constructor(
        private readonly depService: DepService
    ) {
        this.name = 'Peter';
    }
}