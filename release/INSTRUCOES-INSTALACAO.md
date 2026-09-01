# Instruções de instalação / atualização — ONÇA PDV

## Requisitos

- Windows 10 ou Windows 11 (64 bits)
- ~300 MB livres para o aplicativo
- Espaço adicional para banco, backups e logs

## Onde ficam os dados (IMPORTANTE)

O banco **não** fica na pasta do programa (a que o instalador substitui).

Caminhos persistentes (AppData):

1. `%APPDATA%\onca-pdv\ONCA-PDV\onca-pdv.db` ← típico do Electron
2. `%APPDATA%\ONCA-PDV\onca-pdv.db` ← legado / documentação antiga

A nova versão localiza o banco **já existente** e o reutiliza (não cria vazio por cima).

## Atualização em computador em uso (produção)

1. Termine vendas em andamento.
2. Feche totalmente o ONÇA PDV.
3. Execute `ONCA-PDV-Setup-[VERSAO].exe`.
4. Se o instalador detectar banco/dados anteriores, verá o aviso **ATUALIZAÇÃO DO ONÇA PDV** (dados preservados).
5. Clique para atualizar/instalar.
6. Na primeira abertura da nova versão:
   - o banco atual é validado (`integrity_check`);
   - é criado `backups\ONCA-PDV-PRE-ATUALIZACAO-[DATA-HORA].db`;
   - só então rodam migrations incrementais (se houver).

**Nunca** restaure automaticamente um backup antigo enquanto o computador continua vendendo.

## Se o banco não for encontrado

A aplicação **não** cria banco vazio silenciosamente em atualização.

Aparecerá:

**BANCO DA VERSÃO ANTERIOR NÃO ENCONTRADO**

Opções: LOCALIZAR BANCO · LOCALIZAR BACKUP · CANCELAR ATUALIZAÇÃO

## Instalação nova

1. Execute o instalador.
2. Abra pelo atalho **ONÇA PDV**.
3. Faça login e troque a senha do administrador se solicitado.

## Portátil (ZIP)

Descompacte `ONCA-PDV-[VERSAO]-PORTATIL-WINDOWS-X64.zip` e execute o `.exe`.  
Os dados de produção continuam em AppData (não dentro da pasta do ZIP), salvo se `PDV_DATA_DIR` / `PDV_DB_PATH` forem definidos.
