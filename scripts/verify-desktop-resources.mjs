#!/usr/bin/env node
/**
 * Valida desktop-resources antes do electron-builder.
 * Impede regressão: Windows com node Linux / better-sqlite3 ELF.
 *
 * Uso:
 *   node scripts/verify-desktop-resources.mjs win
 *   node scripts/verify-desktop-resources.mjs linux
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'desktop-resources');
const expected = String(process.argv[2] || '').toLowerCase();

if (!['win', 'linux', 'darwin'].includes(expected)) {
  console.error('Uso: node scripts/verify-desktop-resources.mjs <win|linux|darwin>');
  process.exit(1);
}

function fail(msg) {
  console.error(`[verify-desktop] FALHA: ${msg}`);
  process.exit(1);
}

const markerPath = join(out, 'PLATFORM.txt');
if (!existsSync(markerPath)) fail(`ausente PLATFORM.txt em ${out}`);
const marker = readFileSync(markerPath, 'utf8').trim();
if (!marker.startsWith(expected)) {
  fail(`PLATFORM.txt="${marker}" mas o build espera "${expected}"`);
}

const isWin = expected === 'win';
const nodeName = isWin ? 'node.exe' : 'node';
const nodePath = join(out, 'node', nodeName);
if (!existsSync(nodePath)) fail(`runtime ausente: ${nodePath}`);

// Node errado no pacote Windows (regressão 1.2.3)
const wrongNode = join(out, 'node', isWin ? 'node' : 'node.exe');
if (existsSync(wrongNode)) {
  fail(`runtime da plataforma errada presente: ${wrongNode}`);
}

const entry = join(out, 'app-server', 'src', 'index.js');
if (!existsSync(entry)) fail(`API entry ausente: ${entry}`);

const sqlite = join(
  out,
  'app-server',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);
if (!existsSync(sqlite)) fail(`better-sqlite3 nativo ausente: ${sqlite}`);

const fileProbe = spawnSync('file', ['-b', nodePath, sqlite], { encoding: 'utf8' });
const probe = `${fileProbe.stdout || ''}\n${fileProbe.stderr || ''}`;
console.log('[verify-desktop] file probe:\n', probe.trim());

if (isWin) {
  if (!/PE32\+|MS-DOS executable|Windows/i.test(probe)) {
    fail('node.exe / better_sqlite3.node não parecem binários Windows (PE)');
  }
  if (/ELF|GNU\/Linux/i.test(probe)) {
    fail('binários Linux (ELF) encontrados em pacote Windows');
  }
} else if (expected === 'linux') {
  if (!/ELF/i.test(probe)) {
    fail('node / better_sqlite3.node não parecem binários Linux (ELF)');
  }
  if (/PE32\+|MS Windows/i.test(probe)) {
    fail('binários Windows encontrados em pacote Linux');
  }
}

const webIndex = join(out, 'web-dist', 'index.html');
if (!existsSync(webIndex)) fail(`web-dist/index.html ausente`);

console.log(`[verify-desktop] OK para plataforma ${expected}`);
