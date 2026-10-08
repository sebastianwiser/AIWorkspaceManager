#!/usr/bin/env node

import { runCli } from "../src/cli.js";

// Keeping the executable tiny makes the command easy to test and maintain.
runCli(process.argv.slice(2)).catch((error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exitCode = 1;
});
