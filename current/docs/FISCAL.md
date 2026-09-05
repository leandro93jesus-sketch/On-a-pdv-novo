# Fiscal

`IFiscalProvider` isola integrações externas. O provider atual é mock e rejeita ambiente diferente de `Homologacao`. Não gera DANFE/PDF fiscal e não comunica com SEFAZ. Produção fica bloqueada até configuração e provider homologado.
