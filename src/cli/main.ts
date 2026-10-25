#!/usr/bin/env node
import { main } from "./program.ts";

try {
  process.exitCode = await main(process.argv.slice(2));
} catch {
  process.stderr.write("moyyi: Unable to finish cleanly. No further actions were started.\n");
  process.exitCode = 1;
}
