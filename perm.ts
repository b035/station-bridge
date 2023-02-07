import Path from "path";

import { log, Registry, ExitCodes } from "@the-stations-project/sdk";

export default async function perm(BRIDGE_DIR: string, args: string[]) {
	const PERM_DIR = Path.join(BRIDGE_DIR, "perm");

	//get subcommand
	const subcommand = args.splice(0, 2)[0];

	switch (subcommand) {

		default: return ExitCodes.Err;	
	}
}

