import Child from "child_process";
import Fs from "fs/promises";
import Path from "path";

// Basic
export enum ExitCodes {
	Ok = 0,
	ErrUnknown = 1,
	ErrNoCommand = 2,
}

export class Result<C, V> {
	code: C;
	value: V;

	private initial_code: C;
	private initial_value: V;

	log_message: undefined | (() => string);
	panic_message: () => string = () => "Unknown: invalid result.";

	constructor(code: C, value: V) {
		this.initial_code = this.code = code;
		this.initial_value = this.value = value;
	}

	err(cb: (result: Result<C, V>) => any) {
		if (this.has_failed) {
			cb(this);
		}
		return this;
	}

	ok(cb: (result: Result<C, V>) => any) {
		if (!this.has_failed) {
			cb(this);
		}
		return this;
	}

	or_panic(msg?: string) {
		if (this.has_failed) {
			console.trace(this);
			const message = msg ?? this.panic_message();
			log("PANIC", message);
			throw message;
		}
		return this;
	}

	or_log_error(msg?: string) {
		if (this.has_failed) {
			log("ERROR", msg ?? this.panic_message());
		}
		return this;
	}

	to_string(): string {
		return `${this.code}|${this.value}`;
	}

	finalize(code: C, value: V) {
		this.code = code;
		this.value = value;

		if (this.log_message) log("ACTIVITY", this.log_message());

		return this;
	}

	finalize_with_value(value: V) {
		this.value = value;
		return this.finalize(this.code, value);
	}

	finalize_with_code(code: C) {
		this.code = code;
		return this.finalize(code, this.value);
	}

	revert() {
		return this.finalize(this.initial_code, this.initial_value);
	}

	get has_failed(): boolean {
		return this.code > 0;
	}
}

// CLI
export async function start_service(main: (subcommand: string, args: string[]) => Promise<Result<any, any>>, cb: (result: Result<any, any>) => void) {
	const args = process.argv;
	//remove first two args
	args.splice(0, 2);
	//get subcommand
	const subcommand = args.splice(0, 1)[0];
	//run
	const result = await main(subcommand, args);

	cb(result);
}

// Log
export type LogType = "ACTIVITY" | "ERROR" | "PANIC" | "OTHER" | "STATUS";
const LOG_DIR = "logs/current";

export async function log(type: LogType, msg: string) {
	msg = `TYPE ${type}\nPID ${process.pid}\n${msg}\n\n`;
	const timestamp = new Date().toISOString();
	const filename = `log-${timestamp}`;

	const path = Path.join(LOG_DIR, filename);
	(await Registry.append(path, msg)).or_panic("has_failed to log");
}

// Registry
export enum RegistryExitCodes {
	OkUnchanged = -1,
	Ok = 0,
	ErrUnknown = 1,
	ErrRead = 2,
	ErrWrite = 3,
	ErrDel = 4,
}
class RegistryResult<T> extends Result<RegistryExitCodes, T|undefined> {
	constructor() {
		super(RegistryExitCodes.ErrUnknown, undefined);
	}
}

export const Registry = {
	base_path: "registry",
	get_full_path: (path: string) => Path.join(Registry.base_path, ...path.split("/")),

	get_panic_message: (msg: string) => `Registry: ${msg}.`,

	join_paths(...args: string[]): string {
		return args.join("/");
	},

	async mkdir(path: string): Promise<RegistryResult<undefined>> {
		const full_path = Registry.get_full_path(path);

		const result = new RegistryResult<undefined>();
		result.panic_message = () => Registry.get_panic_message(`has_failed to create directory "${path}"`);

		try {
			await Fs.mkdir(full_path, { recursive: true });
			result.finalize_with_code(RegistryExitCodes.Ok);
		} catch {
			(await Registry.test(full_path))
				.ok(() => result.finalize_with_code(RegistryExitCodes.OkUnchanged))
				.err(() => result.finalize_with_code(RegistryExitCodes.ErrUnknown));
		}

		return result;
	},

	async write(path: string, content: string): Promise<RegistryResult<undefined>> {
		const full_path = Registry.get_full_path(path);

		const result = new RegistryResult<undefined>();
		result.panic_message = () => Registry.get_panic_message(`has_failed to write file "${path}"`);

		try {
			await Fs.writeFile(full_path, content);
			result.code = RegistryExitCodes.Ok;
		} catch {
			result.code = RegistryExitCodes.ErrWrite;
		}

		return result;
	},

	async append(path: string, content: string): Promise<RegistryResult<undefined>> {
		const full_path = Registry.get_full_path(path);

		const result = new RegistryResult<undefined>();
		result.panic_message = () => Registry.get_panic_message(`has_failed to append to file "${path}"`);

		try {
			await Fs.appendFile(full_path, content);
			result.finalize_with_code(RegistryExitCodes.Ok);
		} catch {
			result.finalize_with_code(RegistryExitCodes.ErrWrite);
		}

		return result;
	},

	async read(path: string): Promise<RegistryResult<string|undefined>> {
		const full_path = Registry.get_full_path(path);

		const result: RegistryResult<string|undefined> = new RegistryResult<undefined>();
		result.panic_message = () => Registry.get_panic_message(`has_failed to read file "${path}"`);

		try {
			const text = await Fs.readFile(full_path, { encoding: "utf8" });
			result.code = RegistryExitCodes.Ok;
			result.value = text;
		} catch {
			result.code = RegistryExitCodes.ErrRead;
		}

		return result;
	},

	async ls(path: string): Promise<RegistryResult<string[]|undefined>> {
		const full_path = Registry.get_full_path(path);

		const result = new RegistryResult<string[]|undefined>();
		result.panic_message = () => Registry.get_panic_message(`has_failed to read directory "${path}"`);

		try {
			const items = await Fs.readdir(full_path);
			result.finalize(RegistryExitCodes.Ok, items);
		} catch {
			result.finalize_with_code(RegistryExitCodes.ErrRead);
		}

		return result;
	},

	async delete(path: string): Promise<RegistryResult<undefined>> {
		const full_path = Registry.get_full_path(path);

		const result = new RegistryResult<undefined>();
		result.panic_message = () => Registry.get_panic_message(`has_failed to delete item "${path}"`);

		try {
			await Fs.rm(full_path, { recursive: true });
			result.finalize_with_code(RegistryExitCodes.Ok);
		} catch {
			result.finalize_with_code(RegistryExitCodes.ErrDel);
		}

		return result;
	},

	async read_or_create(path: string, default_value: string): Promise<RegistryResult<string|undefined>> {
		const read_result = await Registry.read(path);
		if (!read_result.has_failed) return read_result;

		const write_result = await Registry.write(path, default_value);
		return write_result;
	},

	async test(path: string): Promise<RegistryResult<undefined>> {
		const full_path = Registry.get_full_path(path);

		const result = new RegistryResult<undefined>();

		try {
			await Fs.stat(full_path);
			result.finalize_with_code(RegistryExitCodes.Ok);
		} catch {}

		return result;
	},
	
	async copy(src: string, dest: string): Promise<RegistryResult<undefined>> {
		const full_src = Registry.get_full_path(src);
		const full_dest = Registry.get_full_path(dest);

		const result = new RegistryResult<undefined>();

		try {
			await Fs.cp(full_src, full_dest, { recursive: true });
			result.finalize_with_code(RegistryExitCodes.Ok);
		} catch {}

		return result;
	},

	async move(src: string, dest: string): Promise<RegistryResult<undefined>> {
		const full_src = Registry.get_full_path(src);
		const full_dest = Registry.get_full_path(dest);

		const result = new RegistryResult<undefined>();

		try {
			await Fs.rename(full_src, full_dest);
			result.finalize_with_code(RegistryExitCodes.Ok);
		} catch {}

		return result;
	},
}

// Memory
export const Memory = {
	base_path: "tmp",
	get_full_path: (path: string) => Registry.join_paths(Memory.base_path, path),

	async init(): Promise<RegistryResult<undefined>> {
		await Registry.delete(Memory.base_path);
		return await Registry.mkdir(Memory.base_path);
	},

	mkdir: async (path: string) => await Registry.mkdir(Memory.get_full_path(path)),
	ls: async (path: string) => await Registry.read(Memory.get_full_path(path)),

	remember: async (path: string, content: string) => await Registry.write(Memory.get_full_path(path), content),
	recall: async (path: string) => await Registry.read(Memory.get_full_path(path)),
	forget: async (path: string) => await Registry.delete(Memory.get_full_path(path)),
}

// Shell
class ShellResult extends Result<ExitCodes, Child.ChildProcess|undefined> {
	cmd: string = "";
	panic_message = () => `Shell: an error occured while trying to run "${this.cmd}".`;

	constructor(cmd: string) {
		super(ExitCodes.ErrUnknown, undefined);

		this.cmd = cmd;
	}
}

const PROCESS_TRACKING_DIR = "processes"

export const Shell = {
	async exec(stsh_cmd: string): Promise<ShellResult> {
		let result = new ShellResult(stsh_cmd);

		stsh_cmd = stsh_cmd.replace(/^ /g, "");
		const separator_index = stsh_cmd.indexOf(" ");
		let service, args;

		if (separator_index > -1) {
			service = stsh_cmd.substring(0, separator_index);
			args = stsh_cmd.substring(separator_index);
		} else {
			service = stsh_cmd;
		}

		//get service command
		const cmd_result = await Registry.read(Path.join("services", service));
		if (cmd_result.has_failed) {
			log("ERROR", `Shell: has_failed to get service for "${service}".`);
			return result;
		}

		//get full command
		const service_cmd = cmd_result.value!.split("\n")[0];
		const sys_cmd = `${service_cmd}${args ?? ""}`;

		//spawn process
		const cp = Child.spawn(sys_cmd, {
			shell: true,
			detached: true,
		});

		//track
		Shell.track(sys_cmd, cp);

		result.code = ExitCodes.Ok;
		result.value = cp;
		return result;
	},

	async track(cmd: string, cp: Child.ChildProcess) {
		const pid = cp.pid;

		//safety
		if (pid == undefined) {
			cp.kill();
			return;
		}

		const path = Path.join(PROCESS_TRACKING_DIR, pid.toString());

		const abort = async (type: LogType) => {
			if (cp.killed == false) cp.kill();
			log(type, `Shell: ${pid} dead`);
			(await Memory.forget(path)).or_log_error();
		}

		//create tracking directory if needed
		(await Memory.mkdir(PROCESS_TRACKING_DIR))
			.err(() => abort("ERROR"));
		//track process
		(await Memory.remember(path, ""))
			.err(() => abort("ERROR"))
			.ok(() => log("ACTIVITY", `Shell: started tracking "${cmd}" (${pid})`));
	
		//handle killing
		cp.on("exit", () => abort("STATUS"));
		//in case it already died
		if (cp.exitCode != null) abort("STATUS");
	},

	async kill(pid: number) {
		//check if process exists
		if ((await Memory.recall(Path.join(PROCESS_TRACKING_DIR, pid.toString()))).has_failed) return;

		process.kill(pid);
	}
}
