import { log, Registry, Result, ExitCodes } from "@the-stations-project/sdk";

import { BRIDGE_DIR } from "./index.js";

const PERM_DIR = Registry.join_paths(BRIDGE_DIR, "permissions");

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
	unum: string = "";
	command: string = "";

	panic_message = () => `Bridge: failed to check permissions for user "${this.unum}" with command "${this.command}"`;
}

export async function check(unum: string, cmd: string): Promise<PermissionCheckResult> {
	const result = new PermissionCheckResult(ExitCodes.Err, PrimitivePermissionValues.Denied);
	result.unum = unum;
	result.command = cmd;
	
	function log_result(permission: PermissionValues) {
		log("ACTIVITY", `Bridge: checked permission for "${unum}" with "${cmd}": ${permission}.`);

		result.value = permission;
		return result;
	}

	const action_permissions_result = (await get_action_permissions(cmd)).log_error();
	if (action_permissions_result.failed) return result;
	const action_permissions = action_permissions_result.value!;

	//no errors from here
	result.code = ExitCodes.Ok;

	switch (action_permissions) {
		case PrimitivePermissionValues.Denied: {
			return log_result(PrimitivePermissionValues.Denied);
		}
		case PrimitivePermissionValues.Full: { //everyone can perform this action
			return log_result(PrimitivePermissionValues.Full);
		}
		default: { //check if user can perform action
			const user_permission_result = (await get_user_permissions(unum, action_permissions)).log_error();
			if (user_permission_result.failed) return log_result(PrimitivePermissionValues.Denied);

			switch (user_permission_result.value) {
				case UserPermissionValues.Partial: return log_result(action_permissions);
				case UserPermissionValues.Full: return log_result(PrimitivePermissionValues.Full);
				default: return log_result(PrimitivePermissionValues.Denied);
			}
		}
	}
}

// Action permissions
export class ActionPermissionsResult extends Result<ExitCodes, DetailedPermissionValues|PrimitivePermissionValues.Full|PrimitivePermissionValues.Denied> {
	command: string = "";
	panic_message = () => `Bridge: failed to check permissions for command "${this.command}".`
}

export async function get_action_permissions(cmd: string): Promise<ActionPermissionsResult> {
	const result = new ActionPermissionsResult(ExitCodes.Err, PrimitivePermissionValues.Denied);
	result.command = cmd;

	//get all permission files
	const ls_result = (await Registry.ls(PERM_DIR)).log_error();
	if (ls_result.failed) return result;

	//process command to get filename
	const processed_cmd = cmd.replace(/ /g, "__");

	const matching_file = ls_result.value!
		//get matching files
		.filter(x => new RegExp(`^${x}`).test(processed_cmd))
		//get most precisely matching file
		.reverse()[0];

	//deny if no matching file exists
	if (!matching_file) {
		log("ERROR", `Bridge: no permission file for command "${cmd}" was found.`);
		return result;
	};

	//read permission file
	const file_path = Registry.join_paths(PERM_DIR, matching_file);
	const read_result = (await Registry.read(file_path)).log_error();
	if (read_result.failed) return result;

	//no errors from here
	result.code = ExitCodes.Ok;

	//if everyone has permission
	const [ allow_section, block_section ] = read_result.value!.split("\n---");
	if (allow_section == "all") {
		result.value = PrimitivePermissionValues.Full;
		return result;
	}

	//parse permission file
	const allow_conditions = allow_section
		.split("\n")
		.map(x => x.split(" "));
	const block_conditions = block_section
		.split("\n");

	result.value = {
		allow_conditions,
		block_conditions,
	}
	return result;
}

// User permissions
export enum UserPermissionValues {
	Denied = 0,
	Partial = 1,
	Full = 2,
}
export class UserPermissionsResult extends Result<ExitCodes, UserPermissionValues> {
	unum:  string = "";

	panic_message = () => `Bridge: failed to check user permissions for user "${this.unum}".`;	
}

export async function get_user_permissions(unum: string, action_permissions: DetailedPermissionValues): Promise<UserPermissionsResult> {
	const result = new UserPermissionsResult(ExitCodes.Err, UserPermissionValues.Denied);
	result.unum = unum;

	//get groups the user is in
	const group_path = Registry.join_paths(BRIDGE_DIR, "groups/by-user", unum);
	const user_group_result = (await Registry.ls(group_path)).log_error();
	if (user_group_result.failed) return result;
	const user_groups = user_group_result.value!;

	//no errors from here
	result.code = ExitCodes.Ok;

	for (let group of user_groups) {
		//check the group is blacklisted
		if (action_permissions.block_conditions.indexOf(group) != -1) return result;

		for (let condition of action_permissions.allow_conditions) {
			//check if the group has sole permissions
			result.value = UserPermissionValues.Full;
			if (condition.length == 1 && condition[0] == group) return result; 

			//check if the group has permission at all
			result.value = UserPermissionValues.Partial;
			//get raw group names inside condition
			const condition_groups = condition
				.map(x => x.replace(/^(.*?)[\.%].*$/, "$1"));
			if (condition_groups.indexOf(group) != -1) return result;
		}
	}

	//user does not have permission
	result.value = UserPermissionValues.Denied;
	return result;
}
