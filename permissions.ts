import { log, Registry, Result, ExitCodes } from "@the-stations-project/sdk";

import { BRIDGE_DIR } from "./index.js";

export const PERM_DIR = Registry.join_paths(BRIDGE_DIR, "permissions");

export interface DetailedPermissionValues {
	allow_conditions: string[][];
	block_conditions: string[];
}
export enum PrimitivePermissionValues {
	Denied = 0,
	Full = 2,
}
export type PermissionValues = PrimitivePermissionValues | DetailedPermissionValues;

export class PermissionCheckResult extends Result<ExitCodes, PermissionValues> {
	unum: string;
	command: string;

	panic_message = () => `Bridge: failed to check_permissions permissions for user "${this.unum}" with command "${this.command}"`;
	log_message = () => `Bridge: checked permisison for "${this.unum}" with "${this.command}": ${this.value}.`;

	constructor(unum: string, command: string) {
		super(ExitCodes.Err, PrimitivePermissionValues.Denied);

		this.unum = unum;
		this.command = command;
	}
}

export async function check_permissions(unum: string, cmd: string): Promise<PermissionCheckResult> {
	const result: PermissionCheckResult = new PermissionCheckResult(
		unum,
		cmd,
	);

	const action_permissions_result = (await get_action_permissions(cmd)).log_error();
	if (action_permissions_result.failed) return result.revert();
	const action_permissions = action_permissions_result.value!;

	result.code = ExitCodes.Ok;

	switch (action_permissions) {
		case PrimitivePermissionValues.Denied: {
			return result.finalize_with_value(PrimitivePermissionValues.Denied);
		}
		case PrimitivePermissionValues.Full: { //everyone can perform this action
			return result.finalize_with_value(PrimitivePermissionValues.Full);
		}
		default: { //check_permissions if user can perform action
			const user_permission_result = (await get_user_permissions(unum, action_permissions)).log_error();
			if (user_permission_result.failed) return result.revert();

			switch (user_permission_result.value) {
				case UserPermissionValues.Partial: return result.finalize_with_value(action_permissions);
				case UserPermissionValues.Full: return result.finalize_with_value(PrimitivePermissionValues.Full);
				default: return result.finalize_with_value(PrimitivePermissionValues.Denied);
			}
		}
	}
}

// Action permissions
export class ActionPermissionsResult extends Result<ExitCodes, DetailedPermissionValues|PrimitivePermissionValues.Full|PrimitivePermissionValues.Denied> {
	cmd: string;
	panic_message = () => `Bridge: failed to check_permissions permissions for cmd "${this.cmd}".`

	constructor(cmd: string) {
		super(ExitCodes.Err, PrimitivePermissionValues.Denied);

		this.cmd = cmd;
	}
}

//check_permissionss who can perform the action
export async function get_action_permissions(cmd: string): Promise<ActionPermissionsResult> {
	const result = new ActionPermissionsResult(cmd);

	//get all permission files
	const ls_result = (await Registry.ls(PERM_DIR)).log_error();
	if (ls_result.failed) return result.revert();

	//process cmd to get filename
	const processed_cmd = cmd.replace(/ /g, "__");

	const matching_file = ls_result.value!
		//get matching files
		.filter(x => new RegExp(`^${x}`).test(processed_cmd))
		//get most precisely matching file
		.reverse()[0];

	//deny if no matching file exists
	if (!matching_file) {
		log("ERROR", `Bridge: no permission file for cmd "${cmd}" was found.`);
		return result.revert();
	};

	//read permission file
	const file_path = Registry.join_paths(PERM_DIR, matching_file);
	const read_result = (await Registry.read(file_path)).log_error();
	if (read_result.failed) return result.revert();

	//if everyone has permission
	const [ allow_section, block_section ] = read_result.value!.split("\n---");
	if (allow_section == "all") return result.finalize(ExitCodes.Ok, PrimitivePermissionValues.Full);

	//parse permission file
	const allow_conditions = allow_section
		.split("\n")
		.map(x => x.split(","));
	const block_conditions = block_section
		.split("\n");

	return result.finalize(ExitCodes.Ok, {
		allow_conditions,
		block_conditions,
	});
}

// User permissions
export enum UserPermissionValues {
	Denied = 0,
	Partial = 1,
	Full = 2,
}
export class UserPermissionsResult extends Result<ExitCodes, UserPermissionValues> {
	unum:  string;

	panic_message = () => `Bridge: failed to check_permissions user permissions for user "${this.unum}".`;	

	constructor(unum: string) {
		super(ExitCodes.Err, UserPermissionValues.Denied);

		this.unum = unum;
	}
}

//check_permissionss if the user can perform the action
export async function get_user_permissions(unum: string, action_permissions: DetailedPermissionValues): Promise<UserPermissionsResult> {
	const result = new UserPermissionsResult(unum);

	//get groups the user is in
	const group_path = Registry.join_paths(BRIDGE_DIR, "groups/by-user", unum);
	const user_group_result = (await Registry.ls(group_path)).log_error();
	if (user_group_result.failed) return result.revert();
	const user_groups = user_group_result.value!;

	//no errors from here
	result.code = ExitCodes.Ok;

	for (let group of user_groups) {
		for (let condition of action_permissions.allow_conditions) {
			//check_permissions if group is blacklisted
			if (action_permissions.block_conditions.indexOf(group) != -1) return result.finalize_with_value(UserPermissionValues.Denied);

			//check_permissions if the group has sole permissions
			if (condition.length == 1 && condition[0] == group) return result.finalize_with_value(UserPermissionValues.Full); 

			//check_permissions if the group has permission at all
			//get raw group names inside condition
			const condition_groups = condition
				.map(x => x.replace(/^(.*?)[\.%].*$/, "$1"));
			if (condition_groups.indexOf(group) != -1) return result.finalize_with_value(UserPermissionValues.Partial);
		}
	}

	//user does not have permission
	return result.finalize_with_value(UserPermissionValues.Denied);
}
