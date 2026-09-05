# Deployment, hardware e assinatura

## Máquina limpa

Use uma VM Windows 10 ou 11 sem Visual Studio, .NET SDK ou código-fonte. Copie somente `ONCA-PDV-PRO-Setup.exe`, confirme o SHA-256 publicado e execute o checklist: instalar, abrir, cadastrar produto e cliente, abrir caixa, vender, pagar, gerar PDF, fechar, reabrir e confirmar os dados. Registre versão/edição/build do Windows, código de saída, capturas e `PRAGMA integrity_check`. Este ambiente não dispõe de uma VM limpa; o resultado permanece **PENDENTE DE MÁQUINA LIMPA**.

## Atualização A → B

Instale A, use `%LOCALAPPDATA%\Onca PDV Pro` para gerar dados e feche a aplicação. Calcule contagens de clientes/vendas e hash das configurações. Instale B no mesmo diretório sem remover dados locais. Abra B, execute migrations e compare contagens, configuração e integridade. O instalador contém apenas arquivos de programa; `%LOCALAPPDATA%\Onca PDV Pro\data` nunca integra a seção de remoção ou substituição.

## Authenticode

Obtenha certificado real de code signing, importe-o com chave privada em `Cert:\CurrentUser\My` e instale o Windows SDK (`signtool.exe`). Após publicar e compilar o instalador, execute `scripts\sign-artifacts.ps1 -CertificateThumbprint <THUMBPRINT>`. O script assina com SHA-256, usa timestamp RFC 3161 e verifica ambos os artefatos. Nenhum certificado fictício deve ser usado em distribuição. Estado atual: **PENDENTE DE CERTIFICADO**.

## Impressão física

A tentativa única exige POS-80 online, porta real, fila vazia, mock aprovado, 43 bytes ASCII, corte e gaveta ausentes e uma pessoa observando a impressora. O utilitário grava `PHYSICAL_PRINTING=false` em `finally`. Nunca repetir automaticamente. Testes de acentuação CP850/858/860 permanecem somente em MOCK até autorização manual posterior.

## Fiscal

`IFiscalProvider` permanece isolado do domínio/UI. `HomologacaoFiscalProvider` depende de abstrações de segredo, assinatura, transporte e persistência. O transporte padrão é desabilitado e recusa SEFAZ. Configurações guardam apenas referências para CSC, certificado A1 e senha; os segredos não ficam em configuração comum. Produção continua bloqueada.
