import Crypto from "crypto";

import { ExitCodes, log, Registry, Result, Shell } from "@the-stations-project/sdk";

import { BRIDGE_DIR } from "./index.js";
import { check_permissions, PrimitivePermissionValues } from "./permissions.js";

export const ACTION_DIR = Registry.join_paths(BRIDGE_DIR, "actions");

export default async function main(args: string[]): Promise<Result<any, any>> {
	//get subcommand
	const subcommand = args.splice(0, 1)[0];

	switch (subcommand) {
		case "create": return (await create(args[0], args[1]));
		case "approve": return (await approve(args[0], args[1]));
		case "unapprove": return (await unapprove(args[0], args[1]));
		default: return new Result(ExitCodes.ErrNoCommand, undefined);
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
	response: undefined | ActionExecutionResult //in case granted immediately

	constructor() {
		this.status = ActionStatuses.Rejected;
		this.id = Crypto.randomUUID();
	}

	to_string() {
		return `${this.status}|${this.response?.to_string()}`
	}
}
export class ActionCreationResult extends Result<ExitCodes, Action|undefined> {
	unum: string;
	cmd: string;

	panic_message = () => `Actions: failed to create action for "${this.unum}" with "${this.cmd}".`;

	constructor(unum: string, cmd: string) {
		super(ExitCodes.Err, undefined);

		this.unum = unum;
		this.cmd = cmd;
	} 

	to_string() {
		return `${this.code}|${this.value?.to_string()}`
	}
}

export async function create(cmd: string, unum: string): Promise<ActionCreationResult> {
 	const action = new Action();
	const result = new ActionCreationResult(unum, cmd);

	log("ACTIVITY", `Bridge: trying to create action "${cmd}" (${action.id}) for ${unum}".`);

	//get permissions
	const permissions_result = (await check_permissions(unum, cmd)).log_error();
	if (permissions_result.failed) return result.revert();
	const permissions = permissions_result.value!;

	//no errors from here
	result.code = ExitCodes.Ok;

	switch (permissions) {
		//return if no vote needed
		case PrimitivePermissionValues.Denied:
		case PrimitivePermissionValues.Full: {
			log("STATUS", `Bridge: skipping vote due to action status "${action.status}".`);
			
			if (permissions == PrimitivePermissionValues.Full) {
				action.status = ActionStatuses.Granted;
				action.response = (await execute(cmd));
			}
			return result.finalize_with_value(action);
		}
	}

	//get path
	let action_path = Registry.join_paths(ACTION_DIR, action.id);

	log("ACTIVITY", `Bridge: creating action directory...`);

	//create action directory
	const dir_result = (await Registry.mkdir(action_path)).log_error();
	if (dir_result.failed) return result.revert();

	for (let subdir of [
		"approvals",
	]) {
		(await Registry.mkdir(Registry.join_paths(action_path, subdir))).log_error();
	}
	for (let [filename, content] of [
		["unum", unum],
		["cmd", cmd],
		[Registry.join_paths("approvals", unum), ""],
	]) {
		(await Registry.write(Registry.join_paths(action_path, filename), content)).log_error();
	}

	action.status = ActionStatuses.Pending;

	log("STATUS", `Bridge: action is pending.`);
	return result.finalize_with_value(action);
}

enum ActionChangeExitCodes {
	Ok = 0,
	ErrWrongId = 1,
	ErrUnknown = 2,
}
enum ActionChangeResultValues {
	Permitted = 0,
	Denied = 1,
}
export class ActionChangeResult extends Result<ActionChangeExitCodes, ActionChangeResultValues> {
	change_type: string;
	action_id: string;
	unum: string;

	panic_message = () => `Bridge: failed to ${this.change_type} action "${this.action_id}" (${this.unum}).`;

	constructor(change_type: string, action_id: string, unum: string) {
		super(ActionChangeExitCodes.ErrUnknown, ActionChangeResultValues.Denied);

		this.change_type = change_type;
		this.action_id = action_id;
		this.unum = unum;
	}
}
export async function approve(id: string, unum: string): Promise<ActionChangeResult> {
	const result = new ActionChangeResult(
		"approve",
		id,
		unum,
	)

	//get command
	const action_path = Registry.join_paths(ACTION_DIR, id);
	const cmd_path = Registry.join_paths(action_path, "cmd");
	const cmd_result = (await Registry.read(cmd_path)).log_error();
	if (cmd_result.failed) return result.finalize(ActionChangeExitCodes.ErrWrongId, ActionChangeResultValues.Denied);
	const cmd = cmd_result.value!;

	//check permissions
	result.code = ActionChangeExitCodes.ErrUnknown;
	const permission_result = (await check_permissions(unum, cmd)).log_error();
	if (permission_result.failed) return result.revert();
	const permissions = permission_result.value!;

	//no errors from here
	result.code = ActionChangeExitCodes.Ok;

	//reject if no permission
	if (permissions == PrimitivePermissionValues.Denied) return result.finalize_with_value(ActionChangeResultValues.Denied);

	//approve
	result.value = ActionChangeResultValues.Permitted;
	const approval_path = Registry.join_paths(action_path, "approvals", unum);
	const write_result = (await Registry.write(approval_path, "")).log_error();
	if (write_result.failed) return result.finalize_with_code(ActionChangeExitCodes.ErrUnknown);
	log("ACTIVITY", `Bridge: "${unum}" approved action "${id}".`);

	return result;
}
export async function unapprove(id: string, unum: string): Promise<ActionChangeResult> {
	const result = new ActionChangeResult(
		"unapprove",
		id,
		unum,
	)

	const path = Registry.join_paths(ACTION_DIR, id, "approvals", unum);

	//delete file
	(await Registry.delete(path))
		.ok(() => {
			result.finalize(ActionChangeExitCodes.Ok, ActionChangeResultValues.Permitted);
			log("ACTIVITY", `Bridge: "${unum}" unapproved action "${id}".`);
		})
		.err(() => {
			log("ERROR", `Bridge: "${unum}" could not unapprove action "${id}".`);
		});

	return result;
}

export class ActionExecutionResult extends Result<ExitCodes, string> {
	cmd: string;

	panic_message = () => `Bridge: failed to execute "${this.cmd}"`;

	constructor(cmd: string) {
		super(ExitCodes.Err, "");

		this.cmd = cmd;
	}
}
export function execute(cmd: string): Promise<ActionExecutionResult> {
	return new Promise(async (res) => {
		const result = new ActionExecutionResult(cmd);

		const shell_result = (await Shell.exec(cmd)).log_error();
		if (shell_result.failed) return res(result.revert());

		let output = "";
		const cp = shell_result.value!;
		cp.stdout?.on("data", (data) => output += data.toString());
		cp.stderr?.on("data", (data) => output += data.toString());

		cp.on("exit", () => {
			switch (cp.exitCode) {
				case 0: return res(result.finalize(ExitCodes.Ok, output));
				default: return res(result.finalize(ExitCodes.Err, output));
			}
		});
	});
}
