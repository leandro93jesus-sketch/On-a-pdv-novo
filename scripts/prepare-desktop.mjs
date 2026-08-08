#!/usr/bin/env node
/**
 * Prepara resources do desktop (server + web dist + deps + Node runtime).
 * Não inclui banco real nem backups.
 *
 * Env:
 *   PDV_DESKTOP_PLATFORM=win|linux|darwin (default: host)
 *   PDV_NODE_VERSION — default: mesma versão do Node atual (evita mismatch de ABI)
 */
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  createWriteStream,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'desktop-resources');
const webDist = join(root, 'web', 'dist');
const NODE_VERSION = process.env.PDV_NODE_VERSION || process.versions.node;
const platformMap = {
  win: 'win',
  win32: 'win',
  windows: 'win',
  linux: 'linux',
  darwin: 'darwin',
  mac: 'darwin',
};
const targetPlatform =
  platformMap[String(process.env.PDV_DESKTOP_PLATFORM || process.platform).toLowerCase()] ||
  'linux';
const arch = process.env.PDV_DESKTOP_ARCH || 'x64';
const isWin = targetPlatform === 'win';

if (!existsSync(webDist)) {
  console.error('web/dist ausente. Execute npm run build antes.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'app-server', 'src'), { recursive: true });
mkdirSync(join(out, 'web-dist'), { recursive: true });
mkdirSync(join(out, 'node'), { recursive: true });

cpSync(join(root, 'server', 'src'), join(out, 'app-server', 'src'), { recursive: true });
cpSync(webDist, join(out, 'web-dist'), { recursive: true });

const serverPkg = JSON.parse(readFileSync(join(root, 'server', 'package.json'), 'utf8'));
writeFileSync(
  join(out, 'app-server', 'package.json'),
  JSON.stringify(
    {
      name: '@onca-pdv/server-desktop',
      version: serverPkg.version || '1.0.0',
      private: true,
      type: 'module',
      main: 'src/index.js',
      dependencies: serverPkg.dependencies,
    },
    null,
    2
  )
);

await downloadNodeRuntime({
  version: NODE_VERSION,
  platform: targetPlatform,
  arch,
  destDir: join(out, 'node'),
});

const nodeBin = join(out, 'node', isWin ? 'node.exe' : 'node');
console.log('Instalando dependências de produção do servidor desktop…');

const npmEnv = {
  ...process.env,
  npm_config_platform: isWin ? 'win32' : targetPlatform === 'darwin' ? 'darwin' : 'linux',
  npm_config_arch: arch,
};

const npm = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: join(out, 'app-server'),
  stdio: 'inherit',
  env: npmEnv,
});
if (npm.status !== 0) {
  console.error('Falha ao instalar deps do desktop');
  process.exit(npm.status || 1);
}

rmSync(join(out, 'app-server', 'data'), { recursive: true, force: true });

if (!isWin && targetPlatform === process.platform) {
  const check = spawnSync(
    nodeBin,
    [
      '-e',
      "require('better-sqlite3'); console.log('better-sqlite3 ok modules=' + process.versions.modules)",
    ],
    { cwd: join(out, 'app-server'), encoding: 'utf8' }
  );
  if (check.status !== 0) {
    console.error(check.stderr || check.stdout);
    console.error('Falha: better-sqlite3 incompatível com Node embutido');
    process.exit(1);
  }
  console.log(check.stdout.trim());
}

writeFileSync(
  join(out, 'README.txt'),
  [
    'Recursos internos do ONÇA PDV desktop.',
    'Não contém banco de dados do cliente nem backups reais.',
    `Node embutido: ${NODE_VERSION} (${targetPlatform}-${arch})`,
    '',
  ].join('\n')
);

console.log('desktop-resources pronto:', out);

async function downloadNodeRuntime({ version, platform, arch, destDir }) {
  const win = platform === 'win';
  const ext = win ? 'zip' : 'tar.gz';
  const folder = `node-v${version}-${platform}-${arch}`;
  const url = `https://nodejs.org/dist/v${version}/${folder}.${ext}`;
  const archivePath = join(out, `${folder}.${ext}`);

  console.log('Baixando Node runtime:', url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar Node: HTTP ${res.status} (${url})`);
  }
  await pipeline(res.body, createWriteStream(archivePath));

  if (win) {
    const unzip = spawnSync('unzip', ['-q', archivePath, '-d', out], { stdio: 'inherit' });
    if (unzip.status !== 0) {
      const tar = spawnSync('tar', ['-xf', archivePath, '-C', out], { stdio: 'inherit' });
      if (tar.status !== 0) {
        throw new Error('Não foi possível extrair Node Windows (zip). Instale unzip.');
      }
    }
    const exe = join(out, folder, 'node.exe');
    if (!existsSync(exe)) throw new Error('node.exe não encontrado no pacote');
    cpSync(exe, join(destDir, 'node.exe'));
  } else {
    const tar = spawnSync('tar', ['-xzf', archivePath, '-C', out], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error('Falha ao extrair tar.gz do Node');
    const bin = join(out, folder, 'bin', 'node');
    if (!existsSync(bin)) throw new Error('bin/node não encontrado no pacote');
    cpSync(bin, join(destDir, 'node'));
    chmodSync(join(destDir, 'node'), 0o755);
  }

  rmSync(archivePath, { force: true });
  rmSync(join(out, folder), { recursive: true, force: true });
  console.log('Node runtime em', destDir);
}
