/**
 * CLI for the pre-build docs gate (.forgejo/workflows/build.yml).
 *
 *   DOCS_OUT_DIR=./docs node --import tsx/esm src/ci/gate-cli.ts
 *
 * Exits 1 with one line per problem when the tree must not ship.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { SOURCES } from "../application/sources.js";
import { checkDocsTree, countDocsTree } from "./docs-gate.js";
import { API_OVERVIEW_SOURCES, SOURCE_FLOORS, TOLERATED_MISSING } from "./source-floors.js";

const docsDir = process.env.DOCS_OUT_DIR ?? path.join(process.cwd(), "docs");
const counts = countDocsTree(docsDir);
const overviews: Record<string, boolean> = {};
for (const name of API_OVERVIEW_SOURCES) {
  overviews[name] = fs.existsSync(path.join(docsDir, name, "api", "overview.md"));
}
const problems = checkDocsTree({
  counts,
  sourceNames: SOURCES.map((s) => s.name),
  floors: SOURCE_FLOORS,
  overviews,
  apiSources: API_OVERVIEW_SOURCES,
  tolerated: TOLERATED_MISSING,
});
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (problems.length > 0) {
  console.error(`docs gate: ${problems.length} problem(s) in ${docsDir} - not building:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
for (const [name, why] of Object.entries(TOLERATED_MISSING)) {
  if (!counts[name]) console.warn(`docs gate: tolerating missing ${name} - ${why}`);
}
console.log(`docs gate: ok - ${SOURCES.length} sources, ${total} files`);
