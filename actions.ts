import Crypto from "crypto";

import { ExitCodes, log, Registry, Result, Shell } from "@the-stations-project/sdk";

import { BRIDGE_DIR } from "./index.js";
import { check, PermissionOptions } from "./permissions.js";

export type ActionResultValue = string | undefined;
export class ActionResult extends Result<ExitCodes, ActionResultValue> {
	unum: string = "";
	cmd: string = "";

	panic_message = () => `Actions: failed to create action for "${this.unum}" with "${this.cmd}".`;
}

export async function create(unum: string, cmd: string): Promise<ActionResult> {
	const result = new ActionResult(ExitCodes.Ok, undefined);

	//get permissions
	const permissions_result = (await check(unum, cmd)).log_error();
	if (permissions_result.failed) return result;
	const permissions = permissions_result.value!;

	//return if rejected
	if (permissions == PermissionOptions.Denied) {
		return result;
	}

	//get id
	const action_id = Crypto.randomUUID();

	//approve if full permission
	if (permissions == PermissionOptions.Full) {
		//TODO approve
		result.value = action_id;
		return result;
	}

	//collect data
	const allow_conditions = permissions.allow_conditions;

	//get path
	let action_dir = Registry.join_paths(BRIDGE_DIR, "actions", action_id);
}
