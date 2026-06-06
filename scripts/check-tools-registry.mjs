#!/usr/bin/env node
// scripts/check-tools-registry.mjs
// Verifies that every MCP tool exported under ui/src/mcp/tools/*.ts is
// registered in the TOOLS map in ui/src/mcp/server.ts.
//
// Failure modes:
//   - Tool file exports *Tool but is missing from TOOLS map (forgot to register)
//   - TOOLS map references a *Tool that has no matching export (stale reference)

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const TOOLS_DIR = join(REPO_ROOT, 'ui', 'src', 'mcp', 'tools');
const SERVER_FILE = join(REPO_ROOT, 'ui', 'src', 'mcp', 'server.ts');

const TOOL_FILE_RE = /export\s+(?:const|function)\s+(\w+Tool)\b/g;
// The TOOLS map keys are public snake_case JSON-RPC method names;
// the values are camelCase tool-module identifiers. We must compare against
// the values (camelCase) to detect a forgotten or stale registration.
const REGISTRY_VALUE_RE = /^\s*\w+\s*:\s*(\w+Tool)\s*,?\s*$/gm;

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function ok(msg) {
  console.log('✓ ' + msg);
}

if (!existsSync(TOOLS_DIR)) {
  die(`Tools dir not found: ${TOOLS_DIR}`);
}
if (!existsSync(SERVER_FILE)) {
  die(`Server file not found: ${SERVER_FILE}`);
}

// 1. Collect exported *Tool identifiers from each tool file
const toolFiles = readdirSync(TOOLS_DIR).filter(f => f.endsWith('.ts') && f !== 'index.ts');
const exportedNames = new Set();

for (const f of toolFiles) {
  const src = readFileSync(join(TOOLS_DIR, f), 'utf-8');
  for (const m of src.matchAll(TOOL_FILE_RE)) {
    exportedNames.add(m[1]);
  }
}

if (exportedNames.size === 0) {
  die('No *Tool exports found under ui/src/mcp/tools/ — is the path correct?');
}

ok(`Found ${exportedNames.size} tool exports across ${toolFiles.length} files`);

// 2. Collect *Tool identifiers referenced as values in the TOOLS map
const serverSrc = readFileSync(SERVER_FILE, 'utf-8');
const toolsBlockMatch = serverSrc.match(/const\s+TOOLS\s*:\s*Record<string,\s*ToolModule>\s*=\s*\{([\s\S]*?)\n\}/);
if (!toolsBlockMatch) {
  die('Could not locate `const TOOLS: Record<string, ToolModule> = { ... }` block in ui/src/mcp/server.ts');
}
const toolsBlock = toolsBlockMatch[1];
const registeredNames = new Set();
for (const m of toolsBlock.matchAll(REGISTRY_VALUE_RE)) {
  registeredNames.add(m[1]);
}

ok(`Found ${registeredNames.size} entries in TOOLS map`);

// 3. Compare
const missingFromRegistry = [...exportedNames].filter(n => !registeredNames.has(n));
const staleInRegistry = [...registeredNames].filter(k => !exportedNames.has(k));

let failed = false;
if (missingFromRegistry.length) {
  console.error('✗ Tools exported but NOT registered in TOOLS map:');
  for (const n of missingFromRegistry) {
    console.error('    - ' + n);
  }
  failed = true;
}
if (staleInRegistry.length) {
  console.error('✗ TOOLS map references tools with no matching export:');
  for (const k of staleInRegistry) {
    console.error('    - ' + k);
  }
  failed = true;
}

if (failed) {
  process.exit(1);
}

ok(`All ${exportedNames.size} tools are registered.`);
process.exit(0);
