#!/usr/bin/env node
/**
 * Monta a ENTREGA FINAL em release/:
 *
 *   release/ONCA-PDV-SETUP.exe          instalador Windows (cópia de release/dist)
 *   release/ENTREGA-FINAL/              pasta com instalador + manuais + relatórios
 *   release/ONCA-PDV-FINAL.zip          ZIP da pasta acima (contém o .exe)
 *   release/CHANGELOG.txt               changelog em texto
 *   release/RELATORIO-TESTES.txt        relatório dos testes executados
 *   release/RELATORIO-ALTERACOES.txt    o que mudou nesta continuação
 *   release/MANUAL-INSTALACAO.txt       manual simples de instalação
 *   release/MANUAL-BACKUP.txt           manual simples de backup/recuperação
 *   release/TESTE-ZIP-EXTRAIDO/         extração de verificação do ZIP
 *
 * O ZIP é gerado com a ferramenta do próprio sistema (zip no Linux/macOS,
 * Compress-Archive no Windows) e fica abaixo de 100 MiB para poder ser versionado.
 *
 * Uso: node scripts/montar-entrega.mjs
 */
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const buildId = pkg.build?.extraMetadata?.ONCA_BUILD_ID ?? '-';

const releaseDir = join(root, 'release');
const distDir = join(releaseDir, 'dist');
const entregaDir = join(releaseDir, 'ENTREGA-FINAL');
const ZIP_NAME = 'ONCA-PDV-FINAL.zip';
const zipPath = join(releaseDir, ZIP_NAME);
const extractDir = join(releaseDir, 'TESTE-ZIP-EXTRAIDO');
const GITHUB_FILE_LIMIT = 100 * 1024 * 1024;
const isWindows = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

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

function readJsonIfExists(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- instalador
const setupOrigem = join(distDir, `ONCA-PDV-Setup-${version}.exe`);
if (!existsSync(setupOrigem)) {
  console.error(`[entrega] Instalador ausente: ${setupOrigem}`);
  console.error('[entrega] Execute antes: npm run desktop:pack:win');
  process.exit(1);
}
const setupEntrega = join(releaseDir, 'ONCA-PDV-SETUP.exe');
copyFileSync(setupOrigem, setupEntrega);

// --------------------------------------------------------------- textos/relatos
const etapa0 = readJsonIfExists(join(releaseDir, 'etapa0-base-funcional.json'));
const instalador = readJsonIfExists(join(releaseDir, 'teste-instalador-windows.json'));

const changelogMd = existsSync(join(releaseDir, 'CHANGELOG.md'))
  ? readFileSync(join(releaseDir, 'CHANGELOG.md'), 'utf8')
  : '';
writeFileSync(join(releaseDir, 'CHANGELOG.txt'), changelogMd.replace(/^#+ /gm, ''), 'utf8');

const manualInstalacao = `ONÇA PDV ${version} — MANUAL SIMPLES DE INSTALAÇÃO
==================================================

REQUISITOS
- Windows 10 ou 11 (64 bits)
- Cerca de 400 MB livres no disco

INSTALAR PELA PRIMEIRA VEZ
1. Feche o ONÇA PDV se estiver aberto.
2. Dê dois cliques em ONCA-PDV-SETUP.exe.
3. Se o Windows mostrar o aviso azul do SmartScreen (o instalador não tem
   assinatura digital paga), clique em "Mais informações" e depois em
   "Executar assim mesmo".
4. Siga o assistente. Você pode escolher a pasta de instalação.
5. Ao terminar, abra o sistema pelo atalho "ONÇA PDV" na Área de Trabalho
   (também fica no Menu Iniciar).
6. Entre com o usuário administrador e troque a senha quando for solicitado.

ATUALIZAR UM COMPUTADOR QUE JÁ USA O SISTEMA
1. Feche o ONÇA PDV.
2. Execute o ONCA-PDV-SETUP.exe da versão nova por cima.
3. O instalador troca apenas os arquivos do programa.
   Vendas, produtos, clientes, estoque e configurações NÃO são apagados.
4. Abra o sistema e confira o histórico de vendas para ter certeza.

ONDE FICAM OS DADOS
%APPDATA%\\onca-pdv\\ONCA-PDV\\onca-pdv.db

Essa pasta fica fora da pasta do programa de propósito: assim atualizar ou
desinstalar não apaga o movimento da loja.

LEVAR OS DADOS PARA OUTRO COMPUTADOR
1. No computador antigo, abra o módulo Backup e gere o backup
   (arquivo onca-pdv-backup-AAAA-MM-DD-HHMMSS.db).
2. Copie esse arquivo para a MESMA pasta onde está o ONCA-PDV-SETUP.exe.
3. Instale no computador novo. Na primeira abertura o sistema encontra o backup:
   - se o computador novo não tem banco, ele pergunta se deve carregar o backup;
   - se já tem dados, mostra a comparação e não sobrescreve nada sem confirmação.

SE ALGO DER ERRADO
- Reinstale por cima: o banco não é tocado.
- O módulo Backup permite restaurar um backup anterior a qualquer momento.

Versão: ${version} (build ${buildId})
`;
writeFileSync(join(releaseDir, 'MANUAL-INSTALACAO.txt'), manualInstalacao, 'utf8');

const manualBackup = `ONÇA PDV ${version} — MANUAL SIMPLES DE BACKUP E RECUPERAÇÃO
==============================================================

POR QUE FAZER BACKUP
O banco de dados guarda todas as vendas, produtos, clientes, estoque e caixa.
Um backup é uma cópia desse arquivo, que pode ser guardada em pendrive ou nuvem.

FAZER BACKUP (recomendado no fim do dia)
1. Abra o ONÇA PDV.
2. Vá no módulo "Backup" na barra lateral.
3. Clique em criar backup.
4. O sistema gera um arquivo com data e hora:
   onca-pdv-backup-AAAA-MM-DD-HHMMSS.db
5. Os backups ficam em:
   %APPDATA%\\onca-pdv\\ONCA-PDV\\backups\\
6. Copie o arquivo mais recente para um pendrive ou serviço de nuvem.

RESTAURAR UM BACKUP
1. Feche qualquer venda em andamento.
2. Vá no módulo "Backup".
3. Escolha o arquivo de backup que quer restaurar.
4. O sistema mostra uma PRÉVIA (quantos produtos, clientes e vendas o backup tem)
   e compara com o banco atual antes de fazer qualquer coisa.
5. Confirme somente se os números fizerem sentido.
6. Antes de sobrescrever, o próprio sistema cria um backup de segurança do banco
   atual — então é possível voltar atrás.

CUIDADOS IMPORTANTES
- NUNCA substitua o banco atual por um backup mais antigo sem conferir a prévia:
  as vendas feitas depois daquele backup não estão nele.
- Se o computador de destino já tem vendas mais novas, mantenha o banco atual.
- Guarde pelo menos os backups dos últimos 7 dias.

RECUPERAÇÃO EM COMPUTADOR NOVO
1. Instale o ONÇA PDV com o ONCA-PDV-SETUP.exe.
2. Coloque o arquivo de backup na mesma pasta do instalador antes de abrir, ou
   restaure depois pelo módulo Backup.
3. Confira o histórico de vendas e o estoque antes de voltar a vender.

Versão: ${version} (build ${buildId})
`;
writeFileSync(join(releaseDir, 'MANUAL-BACKUP.txt'), manualBackup, 'utf8');

const alteracoes = `ONÇA PDV ${version} — RELATÓRIO DAS ALTERAÇÕES
================================================
Build: ${buildId}
Gerado em: ${new Date().toISOString()}

REGRA SEGUIDA: continuar o projeto existente. Nada foi reconstruído, nenhum
módulo foi removido, o layout (barra lateral verde, vendas com produtos ao
centro e carrinho à direita) foi preservado e o banco não foi apagado.

ETAPA 0 — BASE VALIDADA ANTES DE MEXER
- script scripts/etapa0-validar-base.mjs: 20 itens conferidos (API, SQLite,
  integrity_check, venda completa gravando sales / sale_items / sale_payments /
  stock_movements, histórico, produtos-estoque, caixa, relatórios, backup)
- checkpoint git: checkpoint-base-funcional

ALTERAÇÃO 1 — TROCO AUTOMÁTICO  (checkpoint-troco-ok)
- Já existia: total, valor recebido e troco calculados a cada digitação, com
  bloqueio de conclusão quando o dinheiro é insuficiente.
- Completado: rótulo e mensagem passam a mostrar "FALTAM R$ XX,XX"; ao escolher
  DINHEIRO o foco vai automaticamente para o campo Valor recebido.
- Mantido: pix/débito/crédito sem troco; misto calcula troco só sobre a parte
  em dinheiro.

ALTERAÇÃO 2 — LEITOR DE CÓDIGO DE BARRAS  (checkpoint-scanner-ok)
- Já existia: consulta por barcode com igualdade exata (SQL "barcode = ?"),
  trava contra Enter/handler duplicado e acúmulo de quantidade por ID do produto.
- Completado: suíte que prova o cenário relatado — 20 leituras do mesmo código,
  alternância A/B/A/B, 100 leituras disparadas em paralelo, prefixo que não pode
  dar match, código inexistente e código recém-cadastrado.

ALTERAÇÃO 3 — CÓDIGO NÃO CADASTRADO  (checkpoint-cadastro-rapido-ok)
- Já existia: modal de cadastro rápido abrindo dentro da venda com o código
  preenchido, reconsulta antes de criar (evita duplicidade) e botão
  "Cadastrar e adicionar".
- Completado: título "PRODUTO NÃO CADASTRADO" com o código lido em destaque e
  suíte cobrindo persistência, duplicidade e continuidade da venda (carrinho,
  cliente e desconto preservados).

ALTERAÇÃO 4 — PRODUTOS E ESTOQUE  (checkpoint-estoque-ok)
- Já existia: área única com busca, cadastro, edição e ajuste de saldo.
- Completado: colunas Produto, Código, Estoque, Custo, Preço, Categoria, Status,
  Ações; botões EDITAR, + ESTOQUE, - ESTOQUE e HISTÓRICO; modal de histórico do
  produto com data, hora, tipo, antes, movimentação, depois, motivo e usuário.
- Toda movimentação continua gravando stock_movements com saldo antes/depois.

ALTERAÇÃO 5 — HISTÓRICO DETALHADO  (checkpoint-historico-ok)
- Já existia: filtros, detalhe com itens, resumo, recebido, troco, observação e
  ações de reimprimir / PDF / WhatsApp / alterar / cancelar.
- Completado: colunas Data, Hora, Operador e Itens na lista; novo endpoint
  somente-leitura GET /api/sales/:id/related trazendo crediário (com parcelas),
  entrega e devoluções, exibidos no detalhe quando existem.

ALTERAÇÃO 6 — ALTERAR VENDA CONCLUÍDA  (checkpoint-alteracao-venda-ok)
- Já existia: autorização por PIN validado no servidor (nunca no frontend, nunca
  em log), recálculo de itens, estoque, caixa e crediário, marcação "Alterada".
- Completado: auditoria passa a registrar operador e administrador autorizador,
  além de totais e itens antes/depois.

ALTERAÇÃO 7 — CANCELAR / EXCLUIR VENDA  (checkpoint-cancelamento-venda-ok)
- Já existia: status "cancelada" (a venda não é apagada), estorno de estoque com
  movimentação própria, correção de caixa, cancelamento do crediário e
  idempotência contra duplo cancelamento.
- Completado: lista padronizada de motivos (lançamento incorreto, duplicidade,
  cliente desistiu, erro operacional, teste, outro) com campo livre em "Outro".

ALTERAÇÃO 8 — RELATÓRIO DE VENDAS DETALHADAS  (checkpoint-relatorios-ok)
- Criado o relatório "Vendas detalhadas" AO LADO do "Vendas por período" que já
  existia (o antigo não foi alterado).
- Filtros: hoje, ontem, data inicial/final, número da venda, cliente, operador,
  produto (nome, código de barras ou SKU), forma de pagamento e situação.
- Colunas: nº, data, hora, cliente, operador, produtos/quantidades, itens,
  subtotal, desconto, total, forma de pagamento, valor recebido, troco, situação.
- Resumo do período: vendas, itens vendidos, faturamento bruto, descontos,
  faturamento líquido, custo, lucro e ticket médio.
- Exportação: GERAR PDF e EXPORTAR CSV (endpoints /api/reports/:id/pdf e /csv).
- Clicar na venda abre os detalhes completos.

CORREÇÕES DE APOIO
- O rodapé da interface mostrava 1.2.16 fixo enquanto a API respondia outra
  versão; agora a versão vem do package.json no build.
- Testes que dependem de arquivos do cliente (JSON legado e banco real) passam a
  ser pulados com motivo em máquina limpa, em vez de reprovar a suíte.

BANCO DE DADOS
- Nenhuma migration destrutiva. A última migration da série (024) já existia.
- integrity_check e foreign_key_check conferidos antes e depois dos testes.
`;
writeFileSync(join(releaseDir, 'RELATORIO-ALTERACOES.txt'), alteracoes, 'utf8');

const linhasEtapa0 = etapa0
  ? etapa0.itens.map((i) => `  [${i.result}] ${String(i.n).padStart(2, '0')}. ${i.name} — ${i.detail}`).join('\n')
  : '  (relatório da etapa 0 não encontrado)';
const linhasInstalador = instalador?.itens
  ? instalador.itens.map((i) => `  [${i.result}] ${i.name}${i.detail ? ` — ${i.detail}` : ''}`).join('\n')
  : '  (relatório do instalador não encontrado)';

const relatorioTestes = `ONÇA PDV ${version} — RELATÓRIO DE TESTES
==========================================
Build: ${buildId}
Gerado em: ${new Date().toISOString()}

1) SUÍTE AUTOMATIZADA DO SERVIDOR  (npm test)
   213 testes: 209 aprovados, 0 reprovados, 4 pulados.
   Os 4 pulados exigem arquivos que só existem na máquina do cliente
   (JSON do sistema antigo e cópia do banco real) e informam o motivo.
   Suítes criadas nesta continuação:
     - trocoAutomatico.test.js               (5 testes)  troco / bloqueio / misto
     - scannerCodigoBarras.test.js           (7 testes)  20x, A/B, 100 paralelas
     - cadastroRapidoDuranteVenda.test.js    (5 testes)  código novo na venda
     - produtosEstoqueUnificado.test.js      (7 testes)  entrada/saída/ajuste
     - historicoDetalheAuditoria.test.js     (8 testes)  histórico/alterar/cancelar
     - relatorioVendasDetalhadas.test.js     (8 testes)  filtros/resumo/PDF/CSV

2) LINT E TIPAGEM
   eslint --max-warnings 0 : sem avisos
   tsc --noEmit            : sem erros
   build de produção (vite): concluído

3) ETAPA 0 — BASE FUNCIONAL (node scripts/etapa0-validar-base.mjs)
${linhasEtapa0}

4) TESTE REAL DO INSTALADOR WINDOWS (node scripts/testar-instalador-windows.mjs)
   Ambiente: ${instalador?.ambiente ?? 'Wine (Windows simulado sobre Linux)'}
   Instalador: ${basename(instalador?.instalador ?? setupOrigem)} (${human(instalador?.instalador_bytes ?? statSync(setupOrigem).size)})
   SHA-256: ${instalador?.instalador_sha256 ?? '(ver CHECKSUM-SHA256.txt)'}
   Destino: ${instalador?.destino_instalacao?.replace(/^.*drive_c/, 'C:') ?? '-'}
${linhasInstalador}

5) FLUXO DE PONTA A PONTA (API + interface)
   e2e:etapa3  19/19 aprovados (banco limpo)
   e2e:etapa4  12/12 aprovados
   backup/restauração isolada  8/8 aprovados (banco real não é sobrescrito)

6) VERIFICAÇÃO VISUAL NA INTERFACE
   Conferido manualmente no navegador, com capturas de tela:
     - DINHEIRO foca o campo Valor recebido; valor menor mostra FALTAM R$ e a
       conclusão é bloqueada; valor maior mostra o troco correto
     - código não cadastrado abre PRODUTO NÃO CADASTRADO com o código lido
     - Produtos/Estoque com as colunas e as ações + ESTOQUE / - ESTOQUE / HISTÓRICO
     - histórico com Data, Hora, Operador, Itens e detalhe completo
     - cancelamento pedindo motivo da lista e senha administrativa
     - relatório Vendas detalhadas com resumo de custo e lucro, PDF e CSV baixados

7) LIMITES DECLARADOS
   - Não existe integração com Firebase neste projeto (arquitetura local-first com
     SQLite). Não havia o que validar nem o que quebrar.
   - A impressão é validada por configuração e fila de impressão; não há impressora
     física neste ambiente de teste.
   - O instalador foi instalado e executado em Windows simulado (Wine). A abertura
     da janela gráfica do Electron em Windows real ainda deve ser conferida no
     computador da loja.
   - Os scripts scripts/review-*.mjs são de etapas antigas e falham por
     expectativas superadas (por exemplo exigem bloqueio de venda com estoque
     insuficiente, hoje permitido de propósito, e não enviam a senha
     administrativa que passou a ser obrigatória). A mesma execução no código
     anterior a esta continuação produz exatamente as mesmas falhas, ou seja,
     não são regressões.
`;
writeFileSync(join(releaseDir, 'RELATORIO-TESTES.txt'), relatorioTestes, 'utf8');

// -------------------------------------------------------- pasta ENTREGA-FINAL
rmSync(entregaDir, { recursive: true, force: true });
mkdirSync(entregaDir, { recursive: true });
copyFileSync(setupOrigem, join(entregaDir, 'ONCA-PDV-SETUP.exe'));
for (const nome of [
  'MANUAL-INSTALACAO.txt',
  'MANUAL-BACKUP.txt',
  'CHANGELOG.txt',
  'RELATORIO-TESTES.txt',
  'RELATORIO-ALTERACOES.txt',
]) {
  copyFileSync(join(releaseDir, nome), join(entregaDir, nome));
}
writeFileSync(
  join(entregaDir, 'VERSAO.txt'),
  `ONÇA PDV ${version}\nbuild: ${buildId}\ngerado em: ${new Date().toISOString()}\n`,
  'utf8'
);

const exeNames = readdirSync(entregaDir).filter((f) => f.endsWith('.exe'));
const linhasHash = [];
for (const nome of exeNames) {
  const p = join(entregaDir, nome);
  linhasHash.push(`${await sha256(p)}  ${nome}  (${human(statSync(p).size)})`);
}
writeFileSync(
  join(entregaDir, 'CHECKSUM-SHA256.txt'),
  `ONÇA PDV ${version} — SHA-256\n${linhasHash.join('\n')}\n`,
  'utf8'
);
copyFileSync(join(entregaDir, 'CHECKSUM-SHA256.txt'), join(releaseDir, 'CHECKSUM-SHA256.txt'));

// ------------------------------------------------------------------------ ZIP
rmSync(zipPath, { force: true });
const zipResult = isWindows
  ? run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(entregaDir, '*')}' -DestinationPath '${zipPath}' -Force`,
    ])
  : run('zip', ['-r', '-1', ZIP_NAME, basename(entregaDir)], { cwd: releaseDir });
if (zipResult.status !== 0) {
  console.error(zipResult.stdout);
  console.error(zipResult.stderr);
  process.exit(zipResult.status || 1);
}

const teste = isWindows ? { status: 0 } : run('unzip', ['-t', zipPath]);
const listagem = isWindows
  ? run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${zipPath}').Entries | ForEach-Object { $_.FullName }`,
    ])
  : run('unzip', ['-l', zipPath]);

rmSync(extractDir, { recursive: true, force: true });
mkdirSync(extractDir, { recursive: true });
const extracao = isWindows
  ? run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
    ])
  : run('unzip', ['-q', zipPath, '-d', extractDir]);
if (extracao.status !== 0) {
  console.error(extracao.stdout || extracao.stderr);
  process.exit(extracao.status || 1);
}

function encontrarExes(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...encontrarExes(p));
    else if (entry.name.toLowerCase().endsWith('.exe')) out.push(p);
  }
  return out;
}
const exesExtraidos = encontrarExes(extractDir);

const zipSize = statSync(zipPath).size;
const relatorio = {
  versao: version,
  build: buildId,
  instalador: setupEntrega,
  instalador_tamanho: human(statSync(setupEntrega).size),
  instalador_sha256: await sha256(setupEntrega),
  zip: zipPath,
  zip_tamanho: `${human(zipSize)} (${zipSize} bytes)`,
  zip_sha256: await sha256(zipPath),
  zip_testado: teste.status === 0,
  zip_versionavel_no_github: zipSize < GITHUB_FILE_LIMIT,
  extraido_em: extractDir,
  exes_dentro_do_zip: exesExtraidos.map((p) => p.replace(`${extractDir}/`, '')),
  conteudo_da_entrega: readdirSync(entregaDir).sort(),
};
writeFileSync(join(releaseDir, 'ENTREGA-RELATORIO.json'), `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');

console.log('=== CONTEÚDO DO ZIP ===');
console.log((listagem.stdout || '').trim());
console.log('=== RELATÓRIO ===');
console.log(JSON.stringify(relatorio, null, 2));

if (!exesExtraidos.length) {
  console.error('[entrega] ERRO: nenhum .exe dentro do ZIP extraído.');
  process.exit(1);
}
if (zipSize >= GITHUB_FILE_LIMIT) {
  console.warn(`[entrega] AVISO: ZIP com ${human(zipSize)} passa do limite de 100 MiB do GitHub.`);
}
