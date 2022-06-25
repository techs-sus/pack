#!/usr/bin/env node

import chalk from "chalk";
import clipboard from "clipboardy";
import express from "express";
import { watchFile } from "fs";
import { readdir, readFile, writeFile } from "fs/promises";
import localtunnel from "localtunnel";
import ora from "ora";
import path from "path";
import { v4 } from "uuid";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";

// below are default config values, to be overriden by `pack.config.json`
let config = {
	serverMain: "./init.lua",
	outFile: "./out.lua",
	clientMain: null,
};
const requireMatchRegexp = /require(\(["'][a-zA-Z/]+["']\))/gm;
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
					read(path.join(cwd, ...split)).then(
						(s) => (found[match.match(/[a-zA-Z0-9/]+/)] = s)
					)
				);
			}
		});
		const m = them;
		await Promise.all(promises);
		m.forEach((match, groupIndex) => {
			if (groupIndex === 0) {
				const matches = match.match(/[a-zA-Z0-9/\/]+/gm);
				const ptr = matches[1];
				string = string.replace(match, `(function() ${found[ptr]} end)()`);
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
	let tunnel;
	const app = express();
	const createTunnel = async () => {
		tunnel = await localtunnel({
			port: 3002,
			subdomain: v4(),
		});
		await clipboard.write(tunnel.url);
	};
	await createTunnel();
	app.get("/", async (_, res) => {
		readFile(path.join(cwd, config.outFile))
			.then(async (buffer) => {
				res.status(200).send(buffer.toString());
				setTimeout(async () => await createTunnel(), 200);
			})
			.catch((e) => res.status(400).send(String(e)));
	});
	console.log("h");
	for (const file of await readdir(cwd)) {
		if (file.endsWith(".lua")) {
			watchFile(path.join(cwd, file), async () => {
				console.log("File %s changed, rebuilding...", file);
				await build();
			});
		}
	}
	console.log("Pack development server running on port 3002");
	app.listen(3002);
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
