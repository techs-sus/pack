#!/usr/bin/env node

import { watchFile } from "fs";
import { v4 } from "uuid";
import { readdir, readFile, writeFile } from "fs/promises";
import { hideBin } from "yargs/helpers";
import localtunnel from "localtunnel";
import clipboard from "clipboardy";
import express from "express";
import chalk from "chalk";
import yargs from "yargs/yargs";
import path from "path";
import ora from "ora";
// below are default config values, to be overriden by `pack.config.json`
let config = {
  serverMain: "./init.lua",
  outFile: "./out.lua",
  clientMain: null,
};
const requireMatchRegexp = /require\(["']([a-zA-Z/\.]+)["']\)/gm;
const cwd = process.cwd();
const argv = yargs(hideBin(process.argv)).argv;
const log = (type, msg) => {
  let s = "";
  switch (type) {
    case "error":
      s = chalk.redBright("[fatal]");
      break;
    case "info":
      s = chalk.blue("[info]");
      break;
    case "warning":
      s = chalk.yellowBright("[warn]");
      break;
    case "success":
      s = chalk.greenBright("[success]");
      break;
    default:
      break;
  }
  console.log(`${s} ${msg}`);
};
const loadConfig = async () => {
  // try and load pack.config.json
  try {
    config = await readFile(path.join(cwd, "pack.config.json")).then((buffer) =>
      JSON.parse(buffer.toString())
    );
    if (!config.clientMain) config.clientMain = null;
    if (!config.serverMain) config.serverMain = "./init.lua";
    if (!config.outFile) config.outFile = "./init.lua";
    log("success", "Read config from pack.config.json!");
  } catch (err) {
    log("warning", "Failed reading config from pack.config.json.");
  }
};

const read = (s) =>
  readFile(s)
    .then((buffer) => buffer.toString())
    .catch((e) => {
      throw e;
    });

const link = async (path3) => {
  let them;
  let _split = path3.split("/");
  let string = await read(path3);
  const path2 = path3.slice(0, path3.length - _split[_split.length - 1].length);
  // TODO: Fix path2 mutation in V8
  while ((them = requireMatchRegexp.exec(string)) !== null) {
    const found = {};
    const promises = [];
    them.forEach((match, groupIndex) => {
      if (groupIndex === 1) {
        const parsed = match.replace(/[\(\)'"]/gm, "");
        const split = parsed.split("/");
        const length = split.length - 1;
        split[length] = split[length] + ".lua";
        // console.log(path.join(path2, ...split), path2);
        promises.push(
          (async () => {
            found[match.match(/[a-zA-Z0-9/]+/)] = await link(
              path.join(path2, ...split)
            );
          })()
        );
      }
    });
    const m = them; // v8 just nulls out them for some reason (garbage collection?)
    await Promise.all(promises);
    m.forEach((match, groupIndex) => {
      if (groupIndex === 0) {
        const ptr = match.match(/[a-zA-Z0-9/]+/gm)[1];
        string = string.replace(
          match,
          `(function(...) ${found[ptr]} end)(...)`
        );
      }
    });
  }
  return string;
};

const build = async () => {
  await loadConfig();
  const finalString = `--> compiled by pack (github.com/techs-sus/pack)\n${await link(
    path.join(cwd, config.serverMain)
  )}${
    (config.clientMain !== null &&
      "\n--> inserting client" +
        `NLS(${await link(
          path.join(cwd, config.clientMain)
        )}, owner.PlayerGui)\n`) ||
    ""
  }`;
  writeFile(path.join(cwd, config.outFile), finalString).catch((e) => {
    throw e;
  });
};

const developmentServer = async () => {
  let app;
  let http;
  let tunnel;
  const createTunnel = async () => {
    if (typeof http !== "undefined") {
      http.close();
    }
    if (typeof tunnel !== "undefined") {
      tunnel.close();
    }
    tunnel = await localtunnel({
      port: 3000,
      subdomain: v4(),
    });
    app = express();
    app.get("/", (_, res) => {
      read(path.join(cwd, config.outFile))
        .then((b) => res.send(b.toString()))
        .catch((e) => res.status(300).send(String(e)));
    });
    http = app.listen(3000);
    clipboard
      .write("h/" + tunnel.url)
      .then(() => log("info", "Wrote URL to clipboard!"))
      .catch((e) => {
        log("error", "Failed writing URL to clipboard! Error: " + String(e));
      });
  };
  await createTunnel();
  for (const file of await readdir(cwd)) {
    if (file.endsWith(".lua")) {
      watchFile(path.join(cwd, file), () => {
        console.log("File %s changed, rebuilding...", file);
        build()
          .then(() =>
            spinner.succeed(chalk.green("Finished building project!"))
          )
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
    let spinner = ora(chalk.blue("Building project..."));
    build()
      .then(() => spinner.succeed(chalk.green("Finished building project!")))
      .catch((e) => {
        throw e;
      });
    break;
  default:
    console.log(
      chalk.red("Pass an positional variable in this array: [dev, build].")
    );
    process.exit(1);
}
