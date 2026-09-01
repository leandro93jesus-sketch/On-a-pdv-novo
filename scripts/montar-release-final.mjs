#!/usr/bin/env node
/**
 * Copia os arquivos finais para diretórios estáveis de artefatos e gera o ZIP do
 * código-fonte completo. Não toca no PDV: só empacota e verifica.
 *
 * Destinos:
 *   /workspace/release-final/    (dentro do projeto)
 *   /opt/cursor/artifacts/       (diretório de artefatos do ambiente)
 *
 * Arquivos:
 *   ONCA-PDV-SETUP.exe                     instalador Windows já testado
 *   ONCA-PDV-CODIGO-FONTE-COMPLETO.zip     todo o código-fonte do projeto
 *
 * Uso: node scripts/montar-release-final.mjs
 */
import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const SETUP_NAME = 'ONCA-PDV-SETUP.exe';
const FONTE_NAME = 'ONCA-PDV-CODIGO-FONTE-COMPLETO.zip';
const destinos = [join(root, 'release-final'), '/opt/cursor/artifacts'];

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ------------------------------------------------------------------ instalador
const setupOrigem = existsSync(join(root, 'release', SETUP_NAME))
  ? join(root, 'release', SETUP_NAME)
  : join(root, 'release', 'dist', `ONCA-PDV-Setup-${version}.exe`);

if (!existsSync(setupOrigem)) {
  console.error(`[release-final] Instalador ausente. Gere com: npm run desktop:pack:win`);
  process.exit(1);
}

// -------------------------------------------------------- ZIP do código-fonte
// Exclui o que é gerado (node_modules, build, empacotamento), o banco real e o
// histórico do git — o objetivo é o código-fonte que compila o projeto.
const fonteTmp = join(root, 'release', FONTE_NAME);
rmSync(fonteTmp, { force: true });
const zip = spawnSync(
  'zip',
  [
    '-r',
    '-9',
    '-q',
    fonteTmp,
    '.',
    '-x',
    '*/node_modules/*',
    'node_modules/*',
    '.git/*',
    '*/.git/*',
    'release/dist/*',
    'release/ENTREGA-FINAL/*',
    'release/TESTE-ZIP-EXTRAIDO/*',
    'release/final/*',
    'release-final/*',
    'release/*.zip',
    'release/*.exe',
    'desktop-resources/*',
    'server/data/*',
    'web/dist/*',
    '*.db',
    '*.db-shm',
    '*.db-wal',
    '*.log',
  ],
  { cwd: root, encoding: 'utf8', timeout: 600000 }
);
if (zip.status !== 0) {
  console.error(zip.stdout);
  console.error(zip.stderr);
  process.exit(zip.status || 1);
}

// ------------------------------------------------------------------- cópias
const resultado = { versao: version, arquivos: [] };
for (const destino of destinos) {
  mkdirSync(destino, { recursive: true });
  for (const [origem, nome] of [
    [setupOrigem, SETUP_NAME],
    [fonteTmp, FONTE_NAME],
  ]) {
    const alvo = join(destino, nome);
    copyFileSync(origem, alvo);
    const size = statSync(alvo).size;
    resultado.arquivos.push({
      caminho: alvo,
      existe: existsSync(alvo),
      bytes: size,
      tamanho: human(size),
      sha256: await sha256(alvo),
    });
  }
}

// Confere que as cópias são idênticas às origens.
const hashSetup = await sha256(setupOrigem);
const hashFonte = await sha256(fonteTmp);
resultado.origem = {
  instalador: { caminho: setupOrigem, sha256: hashSetup, bytes: statSync(setupOrigem).size },
  codigo_fonte: { caminho: fonteTmp, sha256: hashFonte, bytes: statSync(fonteTmp).size },
};
resultado.copias_identicas = resultado.arquivos.every((a) =>
  a.caminho.endsWith(SETUP_NAME) ? a.sha256 === hashSetup : a.sha256 === hashFonte
);

// Lista de checagem em texto ao lado dos arquivos.
for (const destino of destinos) {
  const linhas = resultado.arquivos
    .filter((a) => a.caminho.startsWith(destino))
    .map((a) => `${a.sha256}  ${a.caminho.split('/').pop()}  (${a.tamanho} · ${a.bytes} bytes)`);
  writeFileSync(
    join(destino, 'CHECKSUM-RELEASE-FINAL.txt'),
    `ONÇA PDV ${version} — SHA-256\n${linhas.join('\n')}\n`,
    'utf8'
  );
}

writeFileSync(join(root, 'release', 'release-final.json'), `${JSON.stringify(resultado, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(resultado, null, 2));

if (!resultado.copias_identicas) {
  console.error('[release-final] ERRO: alguma cópia não confere com a origem.');
  process.exit(1);
}
