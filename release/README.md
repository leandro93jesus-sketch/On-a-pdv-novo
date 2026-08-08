# ONÇA PDV 1.0.0 — Release

Sistema de ponto de venda local-first para **ONÇA Produtos de Limpeza**.

## Compatibilidade

| Sistema | Status |
| --- | --- |
| Windows 10 | Prioridade / suportado |
| Windows 11 | Prioridade / suportado |
| Windows 7 | **Não suportado** nesta versão (Electron/Node atuais exigem Windows 10+) |

## Artefatos

- `dist/ONCA-PDV-Setup-1.0.0.exe` — instalador Windows (NSIS), quando gerado nesta máquina/CI
- Pasta portátil Linux (smoke interno): `dist/linux-unpacked/` quando gerada

O instalador **não** embute backups reais nem o banco do estabelecimento.

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
