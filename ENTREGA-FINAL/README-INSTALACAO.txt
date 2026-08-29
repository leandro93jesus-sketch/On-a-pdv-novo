ONÇA PDV 1.2.17 — ENTREGA FINAL (Windows x64)
================================================

ARQUIVOS DESTA PASTA
--------------------
ONCA-PDV-Setup.exe      Instalador (NSIS). Cria atalhos e instala o sistema completo.
README-INSTALACAO.txt   Este arquivo.
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

%APPDATA%\onca-pdv\ONCA-PDV\onca-pdv.db

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
Get-FileHash .\ONCA-PDV-Setup.exe -Algorithm SHA256

Compare o resultado com CHECKSUM-SHA256.txt.

REQUISITOS
----------
Windows 10 ou 11 (x64).
