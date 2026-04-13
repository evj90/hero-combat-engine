import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const macrosDir = path.join(projectRoot, "scripts", "macros");
const outFile = path.join(projectRoot, "scripts", "macro-registry.generated.js");

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function toImportIdentifier(relPath, index) {
  const clean = relPath.replace(/[^a-zA-Z0-9]/g, "_");
  return `macro_${index}_${clean}`;
}

async function listMacroFiles(dir, relBase = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const abs = path.join(dir, entry.name);
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;

    if (entry.isDirectory()) {
      out.push(...(await listMacroFiles(abs, rel)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".js")) continue;

    out.push(rel);
  }

  return out;
}

function buildOutput(files) {
  const header = [
    "// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.",
    "// Run: node tools/build-macro-registry.mjs",
    ""
  ];

  if (!files.length) {
    return [
      ...header,
      "export const macroRegistry = {};",
      "",
      "export async function runRegisteredMacro(name, ...args) {",
      "  const mod = macroRegistry[name];",
      "  if (!mod) throw new Error(`Unknown HERO macro: ${name}`);",
      "  const fn = mod.run ?? mod.default ?? mod.execute;",
      "  if (typeof fn !== \"function\") {",
      "    throw new Error(`Macro module '${name}' must export run(), default, or execute().`);",
      "  }",
      "  return await fn(...args);",
      "}",
      ""
    ].join("\n");
  }

  const sorted = [...files].sort((a, b) => a.localeCompare(b));

  const imports = sorted.map((relPath, i) => {
    const importId = toImportIdentifier(relPath, i + 1);
    const importPath = `./macros/${toPosix(relPath)}`;
    return { importId, relPath, importPath };
  });

  const lines = [...header];

  for (const item of imports) {
    lines.push(`import * as ${item.importId} from \"${item.importPath}\";`);
  }

  lines.push("");
  lines.push("export const macroRegistry = {");
  for (const item of imports) {
    const key = toPosix(item.relPath.replace(/\.js$/i, ""));
    lines.push(`  \"${key}\": ${item.importId},`);
  }
  lines.push("};");
  lines.push("");
  lines.push("export async function runRegisteredMacro(name, ...args) {");
  lines.push("  const mod = macroRegistry[name];");
  lines.push("  if (!mod) throw new Error(`Unknown HERO macro: ${name}`);");
  lines.push("  const fn = mod.run ?? mod.default ?? mod.execute;");
  lines.push("  if (typeof fn !== \"function\") {");
  lines.push("    throw new Error(`Macro module '${name}' must export run(), default, or execute().`);");
  lines.push("  }");
  lines.push("  return await fn(...args);");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  await fs.mkdir(macrosDir, { recursive: true });

  const files = await listMacroFiles(macrosDir);
  const content = buildOutput(files);
  await fs.writeFile(outFile, content, "utf8");

  console.log(`HERO macro registry generated with ${files.length} macro script(s).`);
  console.log(`Output: ${path.relative(projectRoot, outFile)}`);
}

main().catch(err => {
  console.error("Failed to generate HERO macro registry.");
  console.error(err);
  process.exitCode = 1;
});
