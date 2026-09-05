# Gate de deployment e hardware

Data: 04/09/2026

## Status

**DEPLOYMENT/HARDWARE BLOQUEADO COM EVIDÊNCIA**

O software, a atualização, as simulações de hardware e a preparação fiscal estão íntegros. O transporte RAW físico concluiu uma única tentativa autorizada com 43/43 bytes e erro Win32 0. A validação visual do papel ainda depende do operador. O gate não pode ser aprovado porque não há máquina limpa acessível e não há certificado Authenticode.

## Evidências solicitadas

1. Máquina limpa testada? **Não — PENDENTE DE MÁQUINA LIMPA.** Este ambiente não fornece outra VM/host Windows sem SDK.
2. Windows utilizado? Microsoft Windows 11 Pro, versão 10.0.26200, build 26200; esta não é uma máquina limpa.
3. Instalador funcionou sem SDK? Não foi possível provar em máquina limpa. A instalação local isolada e o executável self-contained passaram.
4. Atualização preservou banco? **Sim.** Instalação A 0.1.0 → B 0.1.1, ambas com exit code 0. Antes/depois: clientes 2/2, vendas 1/1, produtos 2/2, schema 2/2, configurações true/true e integridade ok/ok.
5. POS-80 ficou online? Detectada com status `Normal`, driver `POS-80 11.3.0.0`, porta `USB001`, fila com 0 jobs.
6. Teste físico executado? **Sim, exatamente uma tentativa**, em 04/09/2026 18:56:59 -03:00.
7. OpenPrinter: `true`; StartDocPrinter, StartPagePrinter, EndPagePrinter e EndDocPrinter também `true`.
8. WritePrinter: `true`.
9. Bytes solicitados/escritos: 43/43; erro Win32 0.
10. Papel saiu com texto? **PENDENTE DE CONFIRMAÇÃO VISUAL DO OPERADOR.**
11. Houve papel branco? **PENDENTE DE CONFIRMAÇÃO VISUAL DO OPERADOR.**
12. `PHYSICAL_PRINTING` voltou para false? Sim, confirmado no arquivo de estado após o `finally`; a aplicação continua composta somente com `MockPrintService`.
13. Diagnóstico melhorado? Sim: fila, driver, porta, status, papel, encoding, renderer, modo físico, última impressão, bytes e último erro.
14. Falhas simuladas aprovadas? Sim: offline, spooler indisponível, WritePrinter falhando, escrita parcial e papel indisponível. Venda/estoque/caixa não duplicam e reimpressão MOCK permanece possível.
15. Authenticode preparado? Sim: `scripts/sign-artifacts.ps1` assina e verifica EXE/Setup com SHA-256 e timestamp. Estado real de ambos: `NotSigned` — **PENDENTE DE CERTIFICADO**.
16. Fiscal preparado para homologação? Sim: `IFiscalProvider` isolado, `MockFiscalProvider`, `HomologacaoFiscalProvider`, configuração por referências seguras, abstrações de segredo/assinatura/transporte/persistência, XML fixture e transporte padrão bloqueado. Nenhum acesso à SEFAZ.
17. Total de testes: 64.
18. Aprovados: 64.
19. Falhos: 0.
20. Pendências reais: máquina Windows 10/11 limpa; certificado real; confirmação humana explícita para uma única impressão ASCII e inspeção visual do papel.

## Pré-checagem física

- Printer: POS-80.
- Status: Normal.
- Porta: USB001.
- Papel: 80 mm.
- Renderer: EscPos80Renderer.
- Encoding: CP850.
- Texto: 38 caracteres, ASCII exato.
- Bytes: 43; inicialização e LF presentes.
- Corte: ausente.
- Gaveta: ausente.
- MOCK: PASS.
- Fila: vazia.
- Tentativas físicas: exatamente 1; transporte RAW retornou sucesso completo.

## Testes virtuais adicionais

- Acentuação em CP850, CP858 e CP860: aprovada somente em MOCK para ONÇA, IMPRESSÃO, CRÉDITO, DÉBITO, DESCRIÇÃO, CORAÇÃO e AÇÃO.
- Fixtures fiscais: venda simples, múltiplos produtos, desconto, cliente identificado, consumidor, PIX, dinheiro, cartão, misto, rejeição, timeout/contingência e cancelamento de fluxo, sem SEFAZ.
- Regra crítica preservada: falha de impressão ou fiscal não apaga nem duplica venda, estoque ou caixa.

## Artefatos

- Versão B atual: 0.1.1.
- Instalador B: `installer/Output/ONCA-PDV-PRO-Setup.exe`.
- Evidência pré-atualização: `output/upgrade-before.json`.
- Evidência pós-atualização: `output/upgrade-after.json`.
- Pré-checagem MOCK: `gate-hardware-precheck/result.json`.
- Resultado físico único: `gate-hardware-physical-once/physical-result.json`.
- Estado final do bloqueio: `gate-hardware-physical-once/physical-state.json` (`false`).
- Procedimentos: `docs/DEPLOYMENT-HARDWARE.md`.

Não declarar produção pronta. Fiscal real, banco legado e PDV antigo continuam bloqueados.
