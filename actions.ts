import { ExitCodes, log, Registry, Result } from "@the-stations-project/sdk";

export type ActionResultValue = string | undefined;
export class ActionResult extends Result<ExitCodes, ActionResultValue> {
	unum: string = "";
	cmd: string = "";

	panic_message = () => `Actions: failed to create action for "${this.unum}" with "${this.cmd}".`;
}

export async function create(unum: string, cmd: string): Promise<ActionResult> {
}
