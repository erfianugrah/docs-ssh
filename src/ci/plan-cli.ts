/**
 * CLI wrapper around planBuild for .forgejo/workflows/build.yml. Reads env,
 * prints `key=value` lines for $GITHUB_OUTPUT and a human line on stderr.
 *
 *   EVENT=tag|schedule|dispatch FORCE_REFRESH=true|false \
 *   LAST_FETCH_FILE=/path/_build.json FETCHER_CHANGED=true|false|unknown \
 *   node --import tsx/esm src/ci/plan-cli.ts
 */
import * as fs from "node:fs";
import { type BuildEvent, parseLastFetch, planBuild } from "./build-plan.js";

const event = (process.env.EVENT ?? "dispatch") as BuildEvent;
if (!["tag", "schedule", "dispatch"].includes(event)) {
  console.error(`unknown EVENT '${event}'`);
  process.exit(2);
}
let lastText = "";
try {
  lastText = fs.readFileSync(process.env.LAST_FETCH_FILE ?? "", "utf-8");
} catch {
  // no record = empty cache
}
const changed = process.env.FETCHER_CHANGED;
const plan = planBuild({
  event,
  forceRefresh: process.env.FORCE_REFRESH === "true",
  last: parseLastFetch(lastText),
  fetcherChanged: changed === "true" ? true : changed === "false" ? false : null,
  now: new Date(),
});
console.error(`build plan: build=${plan.build} fetch=${plan.fetch} maxAge=${plan.docsMaxAge} - ${plan.reason}`);
console.log(`build=${plan.build}`);
console.log(`fetch=${plan.fetch}`);
console.log(`docs_max_age=${plan.docsMaxAge}`);
console.log(`reason=${plan.reason}`);
