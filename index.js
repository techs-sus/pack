#!/usr/bin/env node

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// below are default config values, to be overriden by `pack.config.json`
let config = {
	serverMain: "./init.lua",
	clientMain: null,
};
const requireMatchRegexp = /require(\(["'][a-zA-Z/]+["']\))/gm;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadConfig = async () => {
	// try and load pack.config.json
	try {
		config = await readFile(path.join(process.cwd(), "pack.config.json")).then(
			(buffer) => JSON.parse(buffer.toString())
		);
		if (!config.clientMain) config.clientMain = null;
		if (!config.serverMain) config.serverMain = "./init.lua";
	} catch (err) {
		console.log("failed reading config from pack.config.json");
	}
};

const read = (p) =>
	readFile(path.join(process.cwd(), p))
		.then((buffer) => buffer.toString())
		.catch((e) => {
			throw e;
		});

const link = async (string) => {
	let them;
	while ((them = requireMatchRegexp.exec(string)) !== null) {
		if (them.index === requireMatchRegexp.lastIndex) {
			break;
		}
		const found = {};
		const promises = [];
		them.forEach((match, groupIndex) => {
			if (groupIndex === 1) {
				const parsed = match
					.replace(/\(/gm, "")
					.replace(/\)/gm, "")
					.replace(/['"]/gm, "");
				const split = parsed.split("/");
				const length = split.length - 1;
				split[length] = split[length] + ".lua";
				promises.push(
					read(path.join(process.pwd(), ...split)).then(
						(s) => (found[match.match(/[a-zA-Z0-9/]+/)] = s)
					)
				);
			}
		});
		const m = them;
		await Promise.all(promises);
		promises.forEach(() => promises.pop());
		m.forEach((match, groupIndex) => {
			if (groupIndex === 0) {
				const matches = match.match(/[a-zA-Z0-9/\/]+/gm);
				matches.forEach(
					(ptr) =>
						ptr.includes("/") &&
						(string = string.replace(match, `(function() ${found[ptr]} end)()`))
				);
			}
		});
	}
	return string;
};

const main = async () => {
	await loadConfig();
	const serverMain = read(config.serverMain);
	const clientMain = read(config.clientMain);
};
