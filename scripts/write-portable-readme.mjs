#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = require(join(root, 'package.json')).version;
const dist = join(root, 'release', 'dist');
const unpacked = join(dist, 'win-unpacked');
const folderName = `ONCA-PDV-${version}-PORTATIL`;
const outDir = join(dist, folderName);
const zipName = `ONCA-PDV-${version}-PORTATIL-WINDOWS-X64.zip`;
const zipPath = join(dist, zipName);

const readme = `ONÇA PDV — VERSÃO PORTÁTIL ${version}

1. Descompacte a pasta.
2. Não execute dentro do ZIP.
3. Abra ONCA-PDV.exe (ou "ONÇA PDV.exe").
4. Configure/valide a impressora em Configurações > Impressoras.
5. Restaure backup se necessário (Backup no menu).
6. Não apague arquivos internos (resources/, etc.).

A configuração de impressoras acompanha o sistema em:
  dados do usuário / configuracoes / impressoras.json
(no Windows: %APPDATA%\\ONCA-PDV\\configuracoes\\impressoras.json)

Bluetooth: o pareamento pertence ao sistema operacional e pode precisar
ser refeito em outro computador. Depois de parear, o PDV tenta reconhecer
a impressora na lista do Windows/Linux.

Não exige Node, npm, Cursor ou VS Code.
`;

if (!existsSync(unpacked)) {
  console.error('win-unpacked ausente. Gere o build Windows antes.');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(unpacked, outDir, { recursive: true });
mkdirSync(join(outDir, 'dados'), { recursive: true });
mkdirSync(join(outDir, 'backups'), { recursive: true });
mkdirSync(join(outDir, 'configuracoes'), { recursive: true });
mkdirSync(join(outDir, 'logs'), { recursive: true });
writeFileSync(join(outDir, 'LEIA-ME.txt'), readme, 'utf8');
writeFileSync(
  join(outDir, 'configuracoes', 'impressoras.json'),
  JSON.stringify(
    {
      schema: 'onca-pdv-impressoras/v1',
      note: 'Preenchido automaticamente ao salvar Configurações > Impressoras no PDV.',
      printers: {},
    },
    null,
    2
  ),
  'utf8'
);

rmSync(zipPath, { force: true });
const zip = spawnSync('zip', ['-r', '-q', zipPath, folderName], {
  cwd: dist,
  stdio: 'inherit',
});
if (zip.status !== 0) {
  console.error('Falha ao gerar ZIP portátil');
  process.exit(zip.status || 1);
}
console.log('Portátil gerado:', zipPath);
