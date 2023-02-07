#! /usr/bin/env node

import Path from "path";

import { Registry } from "@the-stations-project/sdk";

async function main() {
	Registry.write("services/bridge", "npx bridge");

	for (let path of [
		"config/redirects",
		"permissions",
		"actions",
	]) {
		(await Registry.mkdir(get_full_path(path))).or_panic();
	}

	for (let [path, content] of [
		["config/port", "8001"],

		["config/redirects/unregistered", "entrance"],
		["config/redirects/local", "dashboard"],
		["config/redirects/foreign", "dashboard"],
	]) {
		(await Registry.write(get_full_path(path), content)).or_panic();
	}
}

function get_full_path(path: string): string {
	return Path.join("bridge", path);
}

main();
