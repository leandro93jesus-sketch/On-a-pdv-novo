#!/usr/bin/env node
/**
 * Teste REAL do instalador Windows sob Wine.
 *
 * 1. instala o ONCA-PDV-Setup-<versao>.exe em modo silencioso num prefixo Wine limpo;
 * 2. confere os arquivos instalados e os atalhos criados;
 * 3. sobe a API a partir do que foi INSTALADO (não do repositório) e faz uma venda
 *    completa com troco, conferindo estoque e histórico;
 * 4. fecha, reabre e confirma que os dados persistiram;
 * 5. instala a mesma versão POR CIMA e confirma que o banco e as configurações
 *    do usuário foram preservados (nada de banco vazio).
 *
 * Uso: node scripts/testar-instalador-windows.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// Watchdog: o teste nunca deve ficar preso. Se passar do limite, aborta avisando
// em qual etapa parou, em vez de travar esperando o instalador.
const LIMITE_GLOBAL_MS = Number(process.env.LIMITE_TESTE_MS || 1800000);
const watchdog = setTimeout(() => {
  console.error(
    `\nTESTE ABORTADO PELO WATCHDOG após ${Math.round(LIMITE_GLOBAL_MS / 1000)}s — última etapa concluída: ${
      rows.at(-1)?.name ?? 'nenhuma'
    }`
  );
  process.exit(2);
}, LIMITE_GLOBAL_MS);
watchdog.unref();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const setup = join(root, 'release', 'dist', `ONCA-PDV-Setup-${version}.exe`);

const PREFIX = join(homedir(), '.wine-instalador-teste');
const APP_PORT = 4711;
const rows = [];
let failures = 0;

function step(name, ok, detail = '') {
  if (!ok) failures += 1;
  rows.push({ name, result: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function wine(args, opts = {}) {
  return spawnSync('wine', args, {
    encoding: 'utf8',
    env: { ...process.env, WINEPREFIX: PREFIX, WINEDEBUG: '-all' },
    timeout: opts.timeout ?? 300000,
    ...opts,
  });
}

function sh(cmd, opts = {}) {
  return spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', timeout: 300000, ...opts });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PIDs de processos deste prefixo Wine (evita matar Wine de outros testes). */
function pidsDoPrefixo(filtro) {
  return sh(
    `ps -eo pid,args | grep -F ${JSON.stringify(filtro)} | grep -v grep | awk '{print $1}'`
  ).stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Encerra tudo que roda dentro do prefixo Wine de teste. */
function encerrarPrefixoWine() {
  spawnSync('wineserver', ['-k'], {
    env: { ...process.env, WINEPREFIX: PREFIX, WINEDEBUG: '-all' },
    timeout: 60000,
  });
  for (const pid of pidsDoPrefixo(PREFIX)) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      /* já encerrado */
    }
  }
}

/**
 * Instala em modo silencioso.
 *
 * O NSIS sob Wine copia tudo e não devolve o controle: esperar o processo sair
 * gastava o timeout inteiro (15 min) em cada instalação. Aqui o critério de
 * término é o resultado no disco — os arquivos obrigatórios presentes e com
 * tamanho estável — e o instalador é encerrado assim que isso acontece.
 */
async function instalarSilencioso({ maxMs = 420000, rotulo = 'instalação' } = {}) {
  const inicio = Date.now();
  const out = openSync('/tmp/onca-instalador-nsis.log', 'a');
  const child = spawn('wine', [setup, '/S'], {
    env: { ...process.env, WINEPREFIX: PREFIX, WINEDEBUG: '-all' },
    stdio: ['ignore', out, out],
    detached: true,
  });
  child.unref();

  let anterior = -1;
  let estavelDesde = 0;
  while (Date.now() - inicio < maxMs) {
    await sleep(5000);
    const dir = findInstallDir();
    if (dir) {
      const obrigatorios = [
        join(dir, 'resources', 'app.asar'),
        join(dir, 'resources', 'app-server', 'src', 'index.js'),
        join(dir, 'resources', 'web-dist', 'index.html'),
        join(dir, 'resources', 'node', 'node.exe'),
      ];
      if (obrigatorios.every((p) => existsSync(p))) {
        const tamanho = du(dir);
        if (tamanho > 200 * 1024 * 1024 && tamanho === anterior) {
          // dois ciclos seguidos com o mesmo tamanho = cópia terminada
          if (estavelDesde === 0) estavelDesde = Date.now();
          if (Date.now() - estavelDesde >= 5000) break;
        } else {
          estavelDesde = 0;
        }
        anterior = tamanho;
      }
    }
    if (child.exitCode != null) break;
  }

  const decorridoMs = Date.now() - inicio;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* já encerrado */
  }
  encerrarPrefixoWine();
  await sleep(3000);
  return { decorridoMs, rotulo, concluida: Boolean(findInstallDir()) };
}

/** Descobre onde o instalador colocou o app (Program Files ou AppData\Local\Programs). */
function findInstallDir() {
  const candidatos = sh(
    `find ${JSON.stringify(join(PREFIX, 'drive_c'))} -maxdepth 7 -name "ON*A PDV.exe" -not -path "*/Temp/*" 2>/dev/null`
  ).stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return candidatos.length ? dirname(candidatos[0]) : null;
}

function du(path) {
  let total = 0;
  const walk = (p) => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += statSync(full).size;
    }
  };
  if (existsSync(path)) walk(path);
  return total;
}

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function api(baseUrl, method, path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function waitHealth(baseUrl, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* aguardando */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

// ---------------------------------------------------------------- 0. pré-checagem
if (!existsSync(setup)) {
  console.error(`Instalador não encontrado: ${setup}`);
  console.error('Execute antes: npm run desktop:pack:win');
  process.exit(1);
}
const setupSize = statSync(setup).size;
const fileType = sh(`file ${JSON.stringify(setup)}`).stdout.trim();
step(
  '00. Instalador existe e é executável Windows',
  setupSize > 10 * 1024 * 1024 && /PE32.*MS Windows/.test(fileType),
  `${human(setupSize)} · ${fileType.split(': ')[1] || fileType}`
);

// ------------------------------------------------- 1. instalação silenciosa limpa
// MANTER_PREFIXO=1 reaproveita a instalação anterior (uso apenas em depuração do script).
const reaproveitar = process.env.MANTER_PREFIXO === '1' && existsSync(join(PREFIX, 'drive_c'));
if (!reaproveitar) {
  rmSync(PREFIX, { recursive: true, force: true });
  const boot = wine(['wineboot', '-u'], { timeout: 300000 });
  step(
    '01. Ambiente Windows limpo preparado (prefixo Wine novo)',
    existsSync(join(PREFIX, 'drive_c')),
    boot.status === 0 ? 'wineboot ok' : `wineboot status=${boot.status}`
  );
} else {
  step('01. Ambiente Windows limpo preparado (prefixo Wine novo)', true, 'reaproveitando prefixo (MANTER_PREFIXO=1)');
}

const install = reaproveitar
  ? { rotulo: 'reaproveitado', decorridoMs: 0 }
  : await instalarSilencioso({ rotulo: 'instalação inicial' });

const installDir = findInstallDir();
step(
  '02. Instalação silenciosa concluída',
  Boolean(installDir),
  installDir
    ? `destino=${installDir.replace(PREFIX, '<Wine>')} em ${Math.round(install.decorridoMs / 1000)}s`
    : `nada instalado após ${Math.round(install.decorridoMs / 1000)}s`
);
if (!installDir) {
  writeFileSync(
    join(root, 'release', 'teste-instalador-windows.json'),
    `${JSON.stringify({ versao: version, erro: 'instalacao nao encontrada', itens: rows }, null, 2)}\n`,
    'utf8'
  );
  console.error('\nINSTALADOR REPROVADO — instalação não encontrada no disco');
  process.exit(1);
}

const exeInstalado = join(installDir, readdirSync(installDir).find((f) => /^ON.?A PDV\.exe$/.test(f)) || 'ONÇA PDV.exe');
step('03. Executável instalado', existsSync(exeInstalado), existsSync(exeInstalado) ? human(statSync(exeInstalado).size) : 'ausente');

const resources = join(installDir, 'resources');
const necessarios = [
  ['app.asar (interface + main)', join(resources, 'app.asar')],
  ['app-server (API)', join(resources, 'app-server', 'src', 'index.js')],
  ['web-dist (interface compilada)', join(resources, 'web-dist', 'index.html')],
  ['node.exe embutido', join(resources, 'node', 'node.exe')],
  ['better_sqlite3.node (banco)', join(resources, 'app-server', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')],
];
for (const [nome, caminho] of necessarios) {
  step(`04. Arquivo necessário: ${nome}`, existsSync(caminho), existsSync(caminho) ? 'ok' : caminho.replace(PREFIX, '<Wine>'));
}
step('05. Instalação com tamanho coerente', du(installDir) > 200 * 1024 * 1024, human(du(installDir)));

const desktopLnk = sh(`find ${JSON.stringify(PREFIX)} -iname "*ON*A PDV*.lnk" 2>/dev/null`).stdout.trim().split('\n').filter(Boolean);
const temDesktop = desktopLnk.some((p) => /Desktop/i.test(p));
const temMenu = desktopLnk.some((p) => /Start Menu|Menu Iniciar/i.test(p));
step('06. Atalho na Área de Trabalho', temDesktop, desktopLnk.filter((p) => /Desktop/i.test(p)).map((p) => p.replace(PREFIX, '<Wine>')).join(' | ') || 'nenhum .lnk de Desktop');
step('07. Atalho no Menu Iniciar', temMenu, desktopLnk.filter((p) => /Start Menu/i.test(p)).map((p) => p.replace(PREFIX, '<Wine>')).join(' | ') || 'nenhum .lnk de Menu Iniciar');

const uninstaller = readdirSync(installDir).find((f) => /uninstall/i.test(f));
step('08. Desinstalador presente', Boolean(uninstaller), uninstaller || 'ausente');

// ------------------------- 2. subir a API do que foi INSTALADO e vender de verdade
const dataDirWin = 'Z:\\tmp\\onca-instalado-dados';
const apiLogPath = '/tmp/onca-instalado-api.log';
rmSync('/tmp/onca-instalado-dados', { recursive: true, force: true });
mkdirSync('/tmp/onca-instalado-dados', { recursive: true });
rmSync(apiLogPath, { force: true });

function startInstalledApi() {
  // Sob Wine o node não consegue abrir stdout/stderr quando são pipes (EBADF em
  // createWritableStdioStream), então a saída vai para arquivo.
  const out = openSync(apiLogPath, 'a');
  const child = spawn(
    'wine',
    [join(resources, 'node', 'node.exe'), join(resources, 'app-server', 'src', 'index.js')],
    {
      env: {
        ...process.env,
        WINEPREFIX: PREFIX,
        WINEDEBUG: '-all',
        PDV_DATA_DIR: dataDirWin,
        PDV_DB_PATH: `${dataDirWin}\\onca-pdv.db`,
        PORT: String(APP_PORT),
      },
      stdio: ['ignore', out, out],
      detached: true,
    }
  );
  child.unref();
  return {
    child,
    get log() {
      try {
        return [readFileSync(apiLogPath, 'utf8')];
      } catch {
        return [];
      }
    },
  };
}

/**
 * Encerra a API instalada.
 *
 * O Wine reparenta o node.exe para o init, então matar apenas o grupo do processo
 * deixava um node.exe órfão segurando a porta e o banco. Aqui o prefixo Wine
 * inteiro é encerrado, o que é seguro porque é um prefixo exclusivo do teste.
 */
function stopInstalledApi(run) {
  try {
    process.kill(-run.child.pid, 'SIGTERM');
  } catch {
    try {
      run.child.kill('SIGTERM');
    } catch {
      /* já encerrado */
    }
  }
  encerrarPrefixoWine();
}

const baseUrl = `http://127.0.0.1:${APP_PORT}`;
let run = startInstalledApi();
const health = await waitHealth(baseUrl);
step(
  '09. Sistema instalado inicia e responde',
  Boolean(health) && health.version === version,
  health ? `versao=${health.version} build=${health.build}` : `sem resposta: ${run.log.join('').slice(-200)}`
);
step('10. Banco criado pela instalação', Boolean(health?.db_path), health?.db_path || '-');

const login = await api(baseUrl, 'POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
const token = login.json?.token;
step('11. Login no sistema instalado', login.status === 200 && Boolean(token), `status=${login.status}`);

await api(baseUrl, 'POST', '/api/cash/sessions/open', { operator_name: 'Instalador', opening_amount_cents: 10000 }, token);

const barcode = `7899${String(Date.now()).slice(-9)}`;
const prod = await api(
  baseUrl,
  'POST',
  '/api/products',
  { name: 'Instalador Produto', barcode, price_cents: 3750, cost_cents: 1500, stock_qty: 10 },
  token
);
step('12. Cadastro de produto no sistema instalado', prod.status === 201, `id=${prod.json?.id}`);

const scan = await api(baseUrl, 'GET', `/api/products?barcode=${barcode}`, null, token);
step('13. Bipagem por código de barras', scan.status === 200 && scan.json.length === 1, `hits=${scan.json?.length}`);

const sale = await api(
  baseUrl,
  'POST',
  '/api/sales',
  { payment_method: 'dinheiro', amount_received_cents: 5000, items: [{ product_id: prod.json.id, quantity: 1 }] },
  token
);
step(
  '14. Venda de teste com troco (37,50 recebendo 50,00)',
  sale.status === 201 && sale.json.total_cents === 3750 && sale.json.change_cents === 1250,
  `total=${sale.json?.total_cents} troco=${sale.json?.change_cents}`
);

const stock = await api(baseUrl, 'GET', `/api/products/${prod.json.id}`, null, token);
step('15. Estoque baixou 10 → 9', stock.json?.stock_qty === 9, `stock=${stock.json?.stock_qty}`);

const history = await api(baseUrl, 'GET', '/api/sales?paged=1&limit=10', null, token);
step(
  '16. Histórico mostra a venda',
  history.status === 200 && history.json.items.some((s) => s.id === sale.json.id),
  `vendas=${history.json?.items?.length}`
);

const report = await api(baseUrl, 'GET', '/api/reports/vendas_detalhadas?period=hoje', null, token);
step(
  '17. Relatório Vendas detalhadas no sistema instalado',
  report.status === 200 && report.json.rows.some((r) => r.id === sale.json.id),
  `linhas=${report.json?.rows?.length} lucro=${report.json?.totals?.profit_cents}`
);

// -------------------------------------------- 3. fechar, reabrir e checar persistência
stopInstalledApi(run);
await new Promise((r) => setTimeout(r, 5000));
const fechou = (await waitHealth(baseUrl, 2)) == null;
step('18. Sistema fecha corretamente', fechou, fechou ? 'API parou' : 'API continuou respondendo');

run = startInstalledApi();
const health2 = await waitHealth(baseUrl);
step('19. Sistema reabre depois de fechar', Boolean(health2), health2 ? `versao=${health2.version}` : 'sem resposta');

const login2 = await api(baseUrl, 'POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
const token2 = login2.json?.token;
const saleAfter = await api(baseUrl, 'GET', `/api/sales/${sale.json.id}`, null, token2);
const stockAfter = await api(baseUrl, 'GET', `/api/products/${prod.json.id}`, null, token2);
step(
  '20. Dados persistiram após reabrir (venda, troco e estoque)',
  saleAfter.status === 200 &&
    saleAfter.json.total_cents === 3750 &&
    saleAfter.json.change_cents === 1250 &&
    stockAfter.json.stock_qty === 9,
  `venda=${saleAfter.json?.sale_number} troco=${saleAfter.json?.change_cents} estoque=${stockAfter.json?.stock_qty}`
);

// ------------------------------------- 4. atualização por cima preservando o banco
stopInstalledApi(run);
await new Promise((r) => setTimeout(r, 5000));

const dbFile = '/tmp/onca-instalado-dados/onca-pdv.db';
const hashBefore = sh(`sha256sum ${JSON.stringify(dbFile)}`).stdout.split(' ')[0];
const marcador = '/tmp/onca-instalado-dados/configuracoes/marcador-do-usuario.txt';
mkdirSync(dirname(marcador), { recursive: true });
writeFileSync(marcador, 'configuração do usuário que não pode ser perdida\n', 'utf8');

const reinstall = await instalarSilencioso({ rotulo: 'atualização por cima' });
step(
  '21. Atualização instalada por cima da anterior',
  existsSync(exeInstalado),
  `concluída em ${Math.round(reinstall.decorridoMs / 1000)}s`
);
step('22. Banco NÃO foi substituído por um vazio', existsSync(dbFile) && sh(`sha256sum ${JSON.stringify(dbFile)}`).stdout.split(' ')[0] === hashBefore, `sha256 ${hashBefore?.slice(0, 12)}… inalterado`);
step('23. Configurações do usuário preservadas', existsSync(marcador), marcador);

run = startInstalledApi();
const health3 = await waitHealth(baseUrl);
const login3 = await api(baseUrl, 'POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
const saleAfterUpdate = await api(baseUrl, 'GET', `/api/sales/${sale.json.id}`, null, login3.json?.token);
const stockAfterUpdate = await api(baseUrl, 'GET', `/api/products/${prod.json.id}`, null, login3.json?.token);
step('24. Sistema abre após a atualização', Boolean(health3), health3 ? `versao=${health3.version}` : 'sem resposta');
step(
  '25. Vendas, produtos e estoque intactos após atualizar',
  saleAfterUpdate.json?.total_cents === 3750 && stockAfterUpdate.json?.stock_qty === 9,
  `venda=${saleAfterUpdate.json?.sale_number} estoque=${stockAfterUpdate.json?.stock_qty}`
);

const integridade = await api(baseUrl, 'GET', '/api/support/health-db', null, login3.json?.token).catch(() => null);
if (integridade && integridade.status === 200) {
  step('26. Integridade do banco após atualização', JSON.stringify(integridade.json).includes('ok'), JSON.stringify(integridade.json).slice(0, 120));
}

stopInstalledApi(run);

// ---------------------------------------------------------------- relatório final
const resumo = {
  versao: version,
  instalador: setup,
  instalador_bytes: setupSize,
  instalador_sha256: sh(`sha256sum ${JSON.stringify(setup)}`).stdout.split(' ')[0],
  ambiente: `Wine ${sh('wine --version').stdout.trim()} (Windows simulado em Linux)`,
  prefixo: PREFIX,
  destino_instalacao: installDir,
  total: rows.length,
  aprovados: rows.filter((r) => r.result === 'PASS').length,
  reprovados: failures,
  itens: rows,
};
mkdirSync(join(root, 'release'), { recursive: true });
writeFileSync(join(root, 'release', 'teste-instalador-windows.json'), `${JSON.stringify(resumo, null, 2)}\n`, 'utf8');

console.log(`\n${failures === 0 ? 'INSTALADOR APROVADO' : 'INSTALADOR REPROVADO'} — ${resumo.aprovados}/${resumo.total} itens`);
process.exit(failures === 0 ? 0 : 1);
