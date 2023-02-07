#! /usr/bin/env node

import { ExitCodes, start_service } from "@the-stations-project/sdk";

export const BRIDGE_DIR = "bridge";
export const USER_DIR = "users";

async function main(subcommand: string, args: string[]) {
	switch (subcommand) {
		case "test": return await test();

		default: throw ExitCodes.ErrNoCommand;
	}
}

//TODO remove
import * as Permissions from "./perm.js";
async function test() {
	const test_result = (await Permissions.check("5646-1", "test")).or_panic();	
	console.log(test_result.value);
}

start_service(main).then((result: any) => console.log(result));
