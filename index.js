#!/usr/bin/env node

import chalk from "chalk";
import clipboard from "clipboardy";
import { watchFile } from "fs";
import { readdir, readFile, writeFile } from "fs/promises";
import ora from "ora";
import path from "path";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { io } from "socket.io-client";
// below are default config values, to be overriden by `pack.config.json`
let config = {
	serverMain: "./init.lua",
	outFile: "./out.lua",
	clientMain: null,
};
const requireMatchRegexp = /require(\(["'][a-zA-Z/\.]+["']\))/gm;
const cwd = process.cwd();
const argv = yargs(hideBin(process.argv)).argv;
const loadConfig = async () => {
	// try and load pack.config.json
	try {
		config = await readFile(path.join(cwd, "pack.config.json")).then((buffer) =>
			JSON.parse(buffer.toString())
		);
		if (!config.clientMain) config.clientMain = null;
		if (!config.serverMain) config.serverMain = "./init.lua";
		if (!config.outFile) config.outFile = "./init.lua";
	} catch (err) {
		console.log("failed reading config from pack.config.json");
	}
};

const read = (s) =>
	readFile(s)
		.then((buffer) => buffer.toString())
		.catch((e) => {
			throw e;
		});

const link = async (string) => {
	let them;
	while ((them = requireMatchRegexp.exec(string)) !== null) {
		if (them.index === requireMatchRegexp.lastIndex) {
			requireMatchRegexp.lastIndex++;
		}
		const found = {};
		const promises = [];
		them.forEach((match, groupIndex) => {
			if (groupIndex === 1) {
				const parsed = match.replace(/[\(\)'"]/gm, "");
				const split = parsed.split("/");
				const length = split.length - 1;
				split[length] = split[length] + ".lua";
				promises.push(
					(async () => {
						const s = await read(path.join(cwd, ...split));
						found[match.match(/[a-zA-Z0-9/]+/)] = await link(s);
					})()
				);
			}
		});
		const m = them;
		await Promise.all(promises);
		m.forEach((match, groupIndex) => {
			if (groupIndex === 0) {
				const matches = match.match(/[a-zA-Z0-9/\/\.]+/gm);
				const ptr = matches[1];
				string = string.replace(match, `(function(...) ${found[ptr]} end)()`);
			}
		});
	}
	return string;
};

const build = async () => {
	await loadConfig();
	const serverMain = await read(config.serverMain);
	const finalString = `--> built by pack, a module bundler\n${await link(
		serverMain
	)}${
		(config.clientMain !== null &&
			"\n--> insert client" +
				`NLS(${await link(
					await read(config.clientMain)
				)}, owner.PlayerGui)\n`) ||
		""
	}`;
	writeFile(path.join(cwd, config.outFile), finalString).catch((e) => {
		throw e;
	});
};

const developmentServer = async () => {
	const socket = io("https://tempbin.dasus1.repl.co");
	const create = async () => {
		socket.emit("createPaste", await read(path.join(cwd, config.outFile)));
	};
	socket.on("pasteDeleted", () => create());
	socket.on("pasteCreated", async (id) => {
		const url = "https://tempbin.dasus1.repl.co/" + id;
		clipboard
			.write(url)
			.catch((e) =>
				console.log(chalk.red("failed writing to clipboard, " + String(e)))
			)
			.finally(() => console.log(chalk.green("Development URL: " + url)));
	});
	socket.on("connect", () => {
		create();
	});
	for (const file of await readdir(cwd)) {
		if (file.endsWith(".lua") && file.indexOf(config.outFile) !== -1) {
			watchFile(path.join(cwd, file), () => {
				console.log("File %s changed, rebuilding...", file);
				build()
				.then(() => spinner.succeed(chalk.green("Finished building project!")))
				.catch((e) =>
					spinner.fail(chalk.red("Failed building project: " + String(e)))
				);

			});
		}
	}
};

switch (argv._[0]) {
	case "dev":
		developmentServer();
		break;
	case "build":
		let spinner = ora("Building project...");
		build()
			.then(() => spinner.succeed(chalk.green("Finished building project!")))
			.catch((e) =>
				spinner.fail(chalk.red("Failed building project: " + String(e)))
			);
		break;
	default:
		console.log("Provide a positionial argument: dev || build.");
		break;
}
