#! /usr/bin/env node

export const BRIDGE_DIR = "bridge";
export const USER_DIR = "users";

import { ExitCodes, start_service } from "@the-stations-project/sdk";

import actions from "./actions.js";

async function main(subcommand: string, args: string[]) {
	switch (subcommand) {
		case "actions": return actions(args);
		default: throw ExitCodes.ErrNoCommand;
	}
}

start_service(main).then((result: any) => console.log(result));
