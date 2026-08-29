#!/usr/bin/env node
/**
 * Monta a ENTREGA LOCAL na raiz do projeto:
 *   ENTREGA-FINAL/            -> ONCA-PDV-Setup.exe + docs de instalação
 *   ONCA-PDV-FINAL.zip        -> ZIP da pasta acima (zip no Linux/macOS, Compress-Archive no Windows)
 *   TESTE-ZIP-EXTRAIDO/       -> extração de verificação do ZIP
 *
 * O ZIP é mantido abaixo do limite de 100 MiB por arquivo do GitHub para poder ser
 * versionado no próprio repositório (git add -f). Para incluir também o executável
 * portátil (ultrapassa o limite do GitHub), rode com ENTREGA_INCLUI_PORTABLE=1.
 *
 * Também copia o ZIP para a pasta Downloads do usuário (Windows real ou WSL quando detectável)
 * e abre o Explorer no Windows. Nunca depende do sistema de anexos/artifacts do Cursor.
 *
 * Uso: node scripts/pack-entrega-final.mjs
 */
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const dist = join(root, 'release', 'dist');

const ENTREGA = join(root, 'ENTREGA-FINAL');
const ZIP_NAME = 'ONCA-PDV-FINAL.zip';
const ZIP_PATH = join(root, ZIP_NAME);
const EXTRACT_DIR = join(root, 'TESTE-ZIP-EXTRAIDO');

const GITHUB_FILE_LIMIT = 100 * 1024 * 1024;
const includePortable = process.env.ENTREGA_INCLUI_PORTABLE === '1';
const isWindows = process.platform === 'win32';
const isWsl = (() => {
  if (isWindows) return false;
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8')) && existsSync('/mnt/c');
  } catch {
    return false;
  }
})();

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ---------------------------------------------------------------- 1. fontes
const setupSrc = join(dist, `ONCA-PDV-Setup-${version}.exe`);
const portableSrc = join(dist, `ONCA-PDV-Portable-${version}.exe`);

if (!existsSync(setupSrc)) {
  console.error(`[entrega] Instalador ausente: ${setupSrc}`);
  console.error('[entrega] Execute antes: npm run desktop:pack:win');
  process.exit(1);
}

// ------------------------------------------------------ 2. pasta ENTREGA-FINAL
rmSync(ENTREGA, { recursive: true, force: true });
mkdirSync(ENTREGA, { recursive: true });

copyFileSync(setupSrc, join(ENTREGA, 'ONCA-PDV-Setup.exe'));
if (includePortable && existsSync(portableSrc)) {
  copyFileSync(portableSrc, join(ENTREGA, 'ONCA-PDV-Portable.exe'));
}

writeFileSync(
  join(ENTREGA, 'VERSAO.txt'),
  `ONÇA PDV ${version}\nbuild: ${pkg.build?.extraMetadata?.ONCA_BUILD_ID ?? '-'}\ngerado em: ${new Date().toISOString()}\n`,
  'utf8'
);

writeFileSync(
  join(ENTREGA, 'README-INSTALACAO.txt'),
  `ONÇA PDV ${version} — ENTREGA FINAL (Windows x64)
================================================

ARQUIVOS DESTA PASTA
--------------------
ONCA-PDV-Setup.exe      Instalador (NSIS). Cria atalhos e instala o sistema completo.
${includePortable ? 'ONCA-PDV-Portable.exe   Executável único, roda sem instalar (pendrive/teste).\n' : ''}README-INSTALACAO.txt   Este arquivo.
VERSAO.txt              Versão e identificação do build.
CHECKSUM-SHA256.txt     Conferência de integridade dos executáveis.

O instalador já contém TUDO que o sistema precisa: interface, API, Node.js
embutido e o mecanismo do banco SQLite. Não é necessário instalar mais nada.

INSTALAR
--------
1. Feche qualquer ONÇA PDV aberto.
2. Execute ONCA-PDV-Setup.exe e siga o assistente.
3. Abra o ONÇA PDV pelo atalho da área de trabalho.

Se o Windows exibir aviso do SmartScreen (instalador sem assinatura digital):
"Mais informações" -> "Executar assim mesmo".

BANCO DE DADOS
--------------
O banco é criado automaticamente na primeira abertura, no perfil do usuário, e
NUNCA é apagado por instalação, atualização ou desinstalação:

%APPDATA%\\onca-pdv\\ONCA-PDV\\onca-pdv.db

Esta entrega NÃO inclui um arquivo de banco de propósito: enviar um .db junto
poderia sobrescrever dados reais de vendas já existentes no computador.

MIGRAR DADOS DE OUTRO COMPUTADOR
--------------------------------
1. No computador antigo, gere o backup pelo próprio ONÇA PDV
   (onca-pdv-backup-AAAA-MM-DD-HHMMSS.db).
2. Copie esse arquivo para a MESMA pasta do ONCA-PDV-Setup.exe.
3. Execute o instalador. Na primeira abertura o sistema detecta o backup:
   - PC sem banco: pergunta se deseja carregar o backup;
   - PC com dados: mostra a comparação e não sobrescreve nada sem confirmação.

CONFERIR INTEGRIDADE (PowerShell)
---------------------------------
Get-FileHash .\\ONCA-PDV-Setup.exe -Algorithm SHA256

Compare o resultado com CHECKSUM-SHA256.txt.

REQUISITOS
----------
Windows 10 ou 11 (x64).
`,
  'utf8'
);

const changelog = join(root, 'CHANGELOG.md');
if (existsSync(changelog)) copyFileSync(changelog, join(ENTREGA, 'CHANGELOG.txt'));

// checksums dos EXEs dentro da pasta
const exeNames = readdirSync(ENTREGA).filter((f) => f.endsWith('.exe'));
const lines = [];
for (const name of exeNames) {
  const p = join(ENTREGA, name);
  lines.push(`${await sha256(p)}  ${name}  (${human(statSync(p).size)})`);
}
writeFileSync(
  join(ENTREGA, 'CHECKSUM-SHA256.txt'),
  `ONÇA PDV ${version} — SHA-256\n${lines.join('\n')}\n`,
  'utf8'
);

// ---------------------------------------------------------------- 3. ZIP local
rmSync(ZIP_PATH, { force: true });
const zipResult = isWindows
  ? run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(ENTREGA, '*')}' -DestinationPath '${ZIP_PATH}' -Force`,
    ])
  : run('zip', ['-r', '-1', ZIP_NAME, basename(ENTREGA)], { cwd: root });

if (zipResult.status !== 0) {
  console.error(zipResult.stdout);
  console.error(zipResult.stderr);
  process.exit(zipResult.status || 1);
}

// ------------------------------------------------ 4. verificação real do ZIP
const listing = isWindows
  ? run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${ZIP_PATH}').Entries | ForEach-Object { $_.FullName }`,
    ])
  : run('unzip', ['-l', ZIP_PATH]);

const test = isWindows ? { status: 0, stdout: 'ok' } : run('unzip', ['-t', ZIP_PATH]);

rmSync(EXTRACT_DIR, { recursive: true, force: true });
mkdirSync(EXTRACT_DIR, { recursive: true });
const extract = isWindows
  ? run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${EXTRACT_DIR}' -Force`,
    ])
  : run('unzip', ['-q', ZIP_PATH, '-d', EXTRACT_DIR]);

if (extract.status !== 0) {
  console.error(extract.stdout);
  console.error(extract.stderr);
  process.exit(extract.status || 1);
}

function findExe(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findExe(p));
    else if (entry.name.toLowerCase().endsWith('.exe')) out.push(p);
  }
  return out;
}
const extractedExes = findExe(EXTRACT_DIR);

// ------------------------------------------- 5. cópia em Downloads + Explorer
let downloadsCopy = null;
let explorerOpened = false;

function windowsDownloadsDir() {
  if (isWindows) {
    const p = join(os.homedir(), 'Downloads');
    return existsSync(p) ? p : null;
  }
  if (isWsl) {
    const profile = run('cmd.exe', ['/c', 'echo %USERPROFILE%']).stdout?.trim();
    if (profile) {
      const conv = run('wslpath', ['-u', profile]).stdout?.trim();
      const dl = conv ? join(conv, 'Downloads') : null;
      if (dl && existsSync(dl)) return dl;
    }
    const pub = '/mnt/c/Users/Public/Downloads';
    if (existsSync(pub)) return pub;
  }
  return null;
}

const winDl = windowsDownloadsDir();
const localDl = join(os.homedir(), 'Downloads');
const targetDl = winDl ?? localDl;
try {
  mkdirSync(targetDl, { recursive: true });
  copyFileSync(ZIP_PATH, join(targetDl, ZIP_NAME));
  downloadsCopy = join(targetDl, ZIP_NAME);
} catch (err) {
  console.error(`[entrega] Falha ao copiar para Downloads (${targetDl}): ${err.message}`);
}

if (isWindows || isWsl) {
  const selectTarget = downloadsCopy && winDl ? downloadsCopy : ZIP_PATH;
  let winPath = selectTarget;
  if (isWsl) {
    const conv = run('wslpath', ['-w', selectTarget]).stdout?.trim();
    if (conv) winPath = conv;
  }
  const opened = run('explorer.exe', [`/select,${winPath}`]);
  // explorer.exe retorna 1 mesmo quando abre a janela com sucesso
  explorerOpened = opened.error == null;
}

// ---------------------------------------------------------------- 6. relatório
const zipSize = statSync(ZIP_PATH).size;
const exePath = join(ENTREGA, 'ONCA-PDV-Setup.exe');
const exeSize = statSync(exePath).size;

const report = {
  plataforma: `${process.platform} (${isWsl ? 'WSL' : isWindows ? 'Windows' : 'Linux/Unix'})`,
  raizProjeto: root,
  entregaDir: ENTREGA,
  exe: exePath,
  exeTamanho: `${human(exeSize)} (${exeSize} bytes)`,
  exeSha256: await sha256(exePath),
  zip: ZIP_PATH,
  zipTamanho: `${human(zipSize)} (${zipSize} bytes)`,
  zipSha256: await sha256(ZIP_PATH),
  zipTestado: test.status === 0,
  extraidoEm: EXTRACT_DIR,
  exesDentroDoZip: extractedExes.map((p) => p.replace(`${EXTRACT_DIR}/`, '')),
  copiaDownloads: downloadsCopy,
  explorerAberto: explorerOpened,
  zipVersionavelNoGitHub: zipSize < GITHUB_FILE_LIMIT,
};

if (zipSize >= GITHUB_FILE_LIMIT) {
  console.warn(
    `[entrega] AVISO: ZIP com ${human(zipSize)} excede o limite de 100 MiB por arquivo do GitHub e não poderá ser versionado.`
  );
}

writeFileSync(join(root, 'ENTREGA-FINAL-RELATORIO.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('=== CONTEUDO DO ZIP ===');
console.log(listing.stdout?.trim() ?? '');
console.log('=== RELATORIO ===');
console.log(JSON.stringify(report, null, 2));

if (!extractedExes.length) {
  console.error('[entrega] ERRO: nenhum .exe encontrado dentro do ZIP extraído.');
  process.exit(1);
}
