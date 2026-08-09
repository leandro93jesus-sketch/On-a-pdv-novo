# Desktop Windows — ONÇA PDV 1.0.0

## Arquitetura

```
Electron (shell UI)
   └─ spawna Node embutido
         └─ Express + better-sqlite3
               └─ serve web/dist + /api/*
               └─ SQLite em %APPDATA%/ONCA-PDV
```

O banco **nunca** fica na pasta de instalação do Programa Files.

## Dados do usuário

| Item | Caminho (Windows) |
| --- | --- |
| Banco | `%APPDATA%\ONCA-PDV\onca-pdv.db` |
| Backups | `%APPDATA%\ONCA-PDV\backups\` |
| Logs | `%APPDATA%\ONCA-PDV\logs\` |

Em desenvolvimento (não produção): `server/data/`.

## Build

```bash
npm run build
PDV_DESKTOP_PLATFORM=win npm run desktop:prepare
npm run desktop:dist:win
```

Smoke Linux (mesmo host):

```bash
npm run build
PDV_DESKTOP_PLATFORM=linux npm run desktop:prepare
npm run desktop:dist:linux
```

## Compatibilidade

- **Windows 10 / 11**: alvo oficial
- **Windows 7**: não suportado nesta linha (Electron 33+ e Node 20 embutido)

Uma linha legada separada seria necessária para Windows 7 (não implementada).

## Offline

Operações essenciais não dependem de internet. WhatsApp Web/Desktop é recurso externo opcional.
