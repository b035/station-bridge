#! /usr/bin/env node

import { ExitCodes, start_service } from "@the-stations-project/sdk";

import perm from "./perm.js";

const BRIDGE_DIR = "bridge";

async function main(subcommand: string, args: string[]) {
	switch (subcommand) {
		case "perm": return await perm(BRIDGE_DIR, args);

		default: throw ExitCodes.ErrNoCommand;
	}
}

start_service(main).then((result: any) => console.log(result));
