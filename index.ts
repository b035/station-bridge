#! /usr/bin/env node

export const BRIDGE_DIR = "bridge";
export const USER_DIR = "users";

import { ExitCodes, Result, start_service } from "@the-stations-project/sdk";

import actions from "./actions.js";

async function main(subcommand: string, args: string[]): Promise<Result<any, any>> {
	switch (subcommand) {
		case "actions": return await actions(args);
		default: throw ExitCodes.ErrNoCommand;
	}
}

start_service(main, (result) => console.log(result.to_string()));
