#! /usr/bin/env node

import { ExitCodes, start_service } from "@the-stations-project/sdk";

import { create } from "./actions.js";

export const BRIDGE_DIR = "bridge";
export const USER_DIR = "users";

async function main(subcommand: string, args: string[]) {
	switch (subcommand) {
		default: throw ExitCodes.ErrNoCommand;
	}
}

start_service(main).then((result: any) => console.log(result));
