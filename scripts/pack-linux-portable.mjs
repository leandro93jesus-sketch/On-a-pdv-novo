#!/usr/bin/env node
/**
 * Empacota Linux tar.gz SEM depender de FUSE/AppImage.
 * Estrutura: ONCA-PDV-<ver>-LINUX-X64/ com launcher e LEIA-ME.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = require(join(root, 'package.json')).version;
const dist = join(root, 'release', 'dist');
const unpacked = join(dist, 'linux-unpacked');
const folderName = `ONCA-PDV-${version}-LINUX-X64`;
const outDir = join(dist, folderName);
const tarName = `${folderName}.tar.gz`;
const tarPath = join(dist, tarName);

if (!existsSync(unpacked)) {
  console.error('linux-unpacked ausente. Rode desktop:dist:linux antes.');
  process.exit(1);
}

const nodeBin = join(unpacked, 'resources', 'node', 'node');
const winNode = join(unpacked, 'resources', 'node', 'node.exe');
if (!existsSync(nodeBin)) {
  console.error('FALHA: linux-unpacked sem resources/node/node');
  process.exit(1);
}
if (existsSync(winNode)) {
  console.error('FALHA: linux-unpacked contém node.exe (Windows). Regenere com PDV_DESKTOP_PLATFORM=linux.');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(unpacked, outDir, { recursive: true });

const readme = `ONÇA PDV — PACOTE LINUX ${version}

IMPORTANTE:
- Este pacote NÃO exige FUSE (diferente do AppImage).
- Dados (banco, configs, logs) ficam em:
  ~/.config/onca-pdv/ONCA-PDV/
  (ou diretório userData do Electron)

COMO INICIAR:
1. Extraia este arquivo .tar.gz
2. NÃO execute de dentro de um arquivo compactado
3. No terminal:

   chmod +x iniciar-onca-pdv.sh
   ./iniciar-onca-pdv.sh

IMPRESSÃO (CUPS):
- Instale cups se necessário: sudo apt install cups
- Liste impressoras: lpstat -p
- Padrão: lpstat -d
- O PDV tenta Electron e, se falhar, usa CUPS.

APPIMAGE (opcional):
- Requer libfuse.so.2 (Ubuntu 24.04: sudo apt install libfuse2t64)
- Alternativa sem FUSE: APPIMAGE_EXTRACT_AND_RUN=1 ./ONCA-PDV-*.AppImage

NÃO execute o PDV com sudo.
`;

const launcher = `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
export ELECTRON_OZONE_PLATFORM_HINT="\${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
# chrome-sandbox do pacote costuma não ter setuid; o app já usa --no-sandbox no Linux.
exec "$DIR/onca-pdv" --no-sandbox "$@"
`;

writeFileSync(join(outDir, 'LEIA-ME.txt'), readme, 'utf8');
writeFileSync(join(outDir, 'iniciar-onca-pdv.sh'), launcher, { encoding: 'utf8', mode: 0o755 });
chmodSync(join(outDir, 'onca-pdv'), 0o755);

rmSync(tarPath, { force: true });
const tar = spawnSync('tar', ['-czf', tarPath, folderName], { cwd: dist, stdio: 'inherit' });
if (tar.status !== 0) {
  console.error('Falha ao gerar tar.gz Linux');
  process.exit(tar.status || 1);
}
console.log('Pacote Linux gerado:', tarPath);
