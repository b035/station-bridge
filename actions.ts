import Crypto from "crypto";

import { ExitCodes, log, Registry, Result, Shell } from "@the-stations-project/sdk";

import { BRIDGE_DIR } from "./index.js";
import { check, PrimitivePermissionValues } from "./permissions.js";

export default async function main(args: string[]) {
	//get subcommand
	const subcommand = args.splice(0, 1)[0];

	switch (subcommand) {
		case "create": return (await create(args[0], args[1])).value?.to_string();
		default: return ExitCodes.ErrNoCommand;
	}
}

export enum ActionStatuses {
	Rejected = 0,
	Pending = 1,
	Granted = 2,
}
export class Action {
	status: ActionStatuses;
	readonly id: string;
	response: string | undefined; //stdout in case it was granted immediately

	constructor() {
		this.status = ActionStatuses.Rejected;
		this.id = Crypto.randomUUID();
	}

	to_string() {
		return `${this.status}:${this.response ?? this.id}`;
	}
}
export class ActionResult extends Result<ExitCodes, Action> {
	unum: string = "";
	cmd: string = "";

	panic_message = () => `Actions: failed to create action for "${this.unum}" with "${this.cmd}".`;
}

export async function create(unum: string, cmd: string): Promise<ActionResult> {
	const action = new Action();
	const result = new ActionResult(ExitCodes.Err, action);

	log("ACTIVITY", `Bridge: trying to create action "${cmd}" (${action.id}) for ${unum}".`);

	//get permissions
	const permissions_result = (await check(unum, cmd)).log_error();
	if (permissions_result.failed) return result;
	const permissions = permissions_result.value!;

	//no errors from here
	result.code = ExitCodes.Ok;

	switch (permissions) {
		//return if no vote needed
		case PrimitivePermissionValues.Denied:
		case PrimitivePermissionValues.Full: {
			if (permissions == PrimitivePermissionValues.Full) {
				action.status = ActionStatuses.Granted;
				action.response = (await execute(cmd));
			}
			log("STATUS", `Bridge: skipping vote due to action status "${action.status}".`);
			return result;
		}
	}

	//get path
	let action_path = Registry.join_paths(BRIDGE_DIR, "actions", action.id);

	log("ACTIVITY", `Bridge: creating action directory...`);

	//create action directory
	(await Registry.mkdir(action_path)).log_error();
	for (let subdir of [
		"approvals",
		"disapprovals",
		"conditions",
	]) {
		(await Registry.mkdir(Registry.join_paths(action_path, subdir))).log_error();
	}
	for (let [filename, content] of [
		["unum", unum],
		["cmd", cmd],

		["conditions/approval", permissions.allow_conditions.join("\n")],
		["conditions/disapproval", permissions.block_conditions.join("\n")],
	]) {
		(await Registry.write(Registry.join_paths(action_path, filename), content)).log_error();
	}

	action.status = ActionStatuses.Pending;

	log("STATUS", `Bridge: action is pending.`);

	return result;
}

function execute(cmd: string): Promise<string> {
	return new Promise(async (res) => {
		const shell_result = (await Shell.exec(cmd)).log_error();
		if (shell_result.failed) return "error";

		let output = "";
		const cp = shell_result.value!;
		cp.stdout?.on("data", (data) => output += data.toString());

		cp.on("exit", () => res(output));
	});
}
