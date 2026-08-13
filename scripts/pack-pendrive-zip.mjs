#!/usr/bin/env node
/**
 * Gera ONCA-PDV-PENDRIVE-[VERSAO].zip com Setup.exe + LEIA-ME.txt
 * NÃO embute banco .db — o backup fica separado ao lado no pendrive.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const dist = join(root, 'release', 'dist');
const setupName = `ONCA-PDV-Setup-${version}.exe`;
const setupPath = join(dist, setupName);
const outZip = join(dist, `ONCA-PDV-PENDRIVE-${version}.zip`);
const staging = join(dist, `ONCA-PDV-PENDRIVE-${version}`);

if (!existsSync(setupPath)) {
  console.error(`Setup não encontrado: ${setupPath}`);
  console.error('Execute antes: npm run desktop:pack:win');
  process.exit(1);
}

mkdirSync(staging, { recursive: true });
copyFileSync(setupPath, join(staging, setupName));

const readme = `ONÇA PDV — PACOTE PENDRIVE ${version}
=====================================

COMO USAR EM OUTRO COMPUTADOR
-----------------------------

1. Copie esta pasta inteira para o pendrive (ou deixe o ZIP e extraia no pendrive).

2. Coloque na MESMA PASTA do instalador o backup do ONÇA PDV:

   ${setupName}
   onca-pdv-backup-AAAA-MM-DD-HHMMSS.db
   onca-pdv-backup-AAAA-MM-DD-HHMMSS.manifest.json   (opcional, recomendado)

3. No computador de destino, feche qualquer ONÇA PDV aberto.

4. Execute ${setupName}

5. Na primeira abertura:
   - Se o PC NÃO tiver banco: o ONÇA PDV detecta o backup sozinho e pergunta
     se deseja INSTALAR E CARREGAR ESTE BACKUP.
   - Se o PC JÁ tiver dados: NÃO sobrescreve automaticamente. Mostra comparação
     e deixa você MANTER o banco atual ou restaurar com backup de segurança.

6. O banco é COPIADO para o AppData do Windows (não fica no pendrive).

7. Depois de abrir e conferir os dados, pode RETIRAR o pendrive.
   O ONÇA PDV continua funcionando com a cópia local.

IMPORTANTE
----------
- NÃO apague nem substitua o banco atual sem ler os avisos.
- Se o computador já tem vendas mais novas que o backup, mantenha o banco atual.
- Este pacote NÃO inclui um banco embutido no EXE de propósito.

Caminho típico do banco no PC:
%APPDATA%\\onca-pdv\\ONCA-PDV\\onca-pdv.db
`;

writeFileSync(join(staging, 'LEIA-ME.txt'), readme, 'utf8');

const zipCmd = spawnSync(
  'bash',
  ['-lc', `cd ${JSON.stringify(dist)} && rm -f ${JSON.stringify(`ONCA-PDV-PENDRIVE-${version}.zip`)} && zip -r -9 ${JSON.stringify(`ONCA-PDV-PENDRIVE-${version}.zip`)} ${JSON.stringify(`ONCA-PDV-PENDRIVE-${version}`)}`],
  { encoding: 'utf8' }
);
if (zipCmd.status !== 0) {
  console.error(zipCmd.stdout);
  console.error(zipCmd.stderr);
  process.exit(zipCmd.status || 1);
}

console.log(`OK: ${outZip}`);
console.log(`Staging: ${staging}`);
console.log('Coloque o .db/.manifest ao lado do Setup.exe no pendrive (não embutidos).');
