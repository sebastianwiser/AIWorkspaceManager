import process from "node:process";
import { runCli } from "./cli.js";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unexpected error: ${message}`);
  process.exitCode = 1;
});
