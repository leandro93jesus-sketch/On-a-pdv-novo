# ONÇA PDV 1.0.0 — Release

Sistema de ponto de venda local-first para **ONÇA Produtos de Limpeza**.

## Compatibilidade

| Sistema | Status |
| --- | --- |
| Windows 10 | Prioridade / suportado |
| Windows 11 | Prioridade / suportado |
| Windows 7 | **Não suportado** nesta versão (Electron/Node atuais exigem Windows 10+) |

## Artefatos

- `dist/ONCA-PDV-Setup-1.0.0.exe` — instalador Windows (NSIS)
- `dist/ONCA-PDV-1.0.0-win-x64.zip` — pacote portátil (pasta `win-unpacked`)
- `dist/ONCA-PDV-Setup-1.0.0.zip` — zip gerado pelo electron-builder
- Pasta Linux de smoke interno: `dist/linux-unpacked/` (não é entrega ao cliente Windows)

O instalador **não** embute backups reais nem o banco do estabelecimento.

> Antes do go-live, validar o Setup.exe em um Windows 10/11 limpo (abrir app, login, venda, PDF, backup).

## Instalação (Windows)

1. Execute `ONCA-PDV-Setup-1.0.0.exe`
2. Escolha pasta de instalação (padrão do Programa Files / App)
3. Marque atalho na área de trabalho se desejar
4. Abra **ONÇA PDV** pelo menu Iniciar

Na primeira execução o sistema cria a estrutura em:

`%APPDATA%\ONCA-PDV\`

Subpastas:

- `onca-pdv.db` — banco SQLite
- `backups\` — backups
- `logs\` — logs de diagnóstico

## Primeiro acesso

Usuário bootstrap: `admin`  
Senha inicial temporária exige **troca imediata** no primeiro login.

Nunca deixe a senha bootstrap em produção.

## Operação offline

Vendas, produtos, estoque, clientes, caixa, crediário e relatórios locais funcionam **sem internet**.

Internet só é necessária para abrir WhatsApp Web/Desktop externo.

## Backup e restauração

Veja:

- `INSTRUCOES-BACKUP.md`
- `INSTRUCOES-RESTAURACAO.md`

## Versão

- Aplicativo: **ONÇA PDV 1.0.0**
- Build: 2026.08.08
