using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Infrastructure;

namespace OncaPDV.Migration;

public sealed record LegacyEntityPlan(
    string Entity,
    string? Table,
    long Found,
    long Importable,
    long Existing,
    long Conflicts,
    long Ignored,
    decimal FinancialTotal = 0,
    decimal StockTotal = 0);

public sealed record LegacyDryRunReport(
    string Source,
    string Format,
    string Sha256Before,
    string Sha256After,
    IReadOnlyList<LegacyEntityPlan> Entities,
    IReadOnlyList<string> Conflicts,
    bool SourcePreserved,
    bool ImportExecuted)
{
    public LegacyEntityPlan Entity(string name) => Entities.Single(x => x.Entity == name);
}

public sealed record LegacyImportResult(
    string SourceHash,
    bool AlreadyImported,
    IReadOnlyDictionary<string, long> Imported,
    string Integrity,
    decimal StockBefore,
    decimal StockAfter,
    decimal FinancialTotal);

public sealed class LegacyImportService(OncaDatabase target)
{
    // Inclui os nomes usados pelo PDV legado 1.2.x e aliases de versões mais antigas.
    private static readonly Dictionary<string, string[]> Tables = new(StringComparer.OrdinalIgnoreCase)
    {
        ["products"] = ["products", "produtos"],
        ["customers"] = ["customers", "clientes"],
        ["sales"] = ["sales", "vendas"],
        ["sale_items"] = ["sale_items", "itens_venda", "vendas_itens"],
        ["payments"] = ["sale_payments", "payments", "pagamentos", "vendas_pagamentos"],
        ["credit"] = ["credit_accounts", "crediario", "fiado"],
        ["credit_installments"] = ["credit_installments", "crediario_parcelas", "parcelas_crediario"],
        ["credit_payments"] = ["credit_payments", "credit_receipts", "recebimentos_crediario"],
        ["suppliers"] = ["suppliers", "fornecedores"],
        ["purchases"] = ["purchases", "compras"],
        ["purchase_items"] = ["purchase_items", "itens_compra", "compras_itens"],
        ["cash_sessions"] = ["cash_sessions", "sessoes_caixa"],
        ["cash"] = ["cash_movements", "movimentos_caixa", "caixa"],
        ["stock_movements"] = ["stock_movements", "movimentos_estoque"],
        ["delivery_orders"] = ["delivery_orders", "pedidos_entrega"],
        ["delivery_order_items"] = ["delivery_order_items", "itens_pedido_entrega"],
        ["delivery_order_payments"] = ["delivery_order_payments", "pagamentos_pedido_entrega"],
        ["quotes"] = ["quotes", "orcamentos"],
        ["quote_items"] = ["quote_items", "itens_orcamento"],
        ["returns"] = ["returns", "devolucoes"],
        ["return_items"] = ["return_items", "itens_devolucao"],
        ["users"] = ["users", "usuarios"],
        ["settings"] = ["settings", "configuracoes"]
    };

    public async Task<LegacyDryRunReport> DryRunAsync(string source, CancellationToken ct = default)
    {
        var full = Path.GetFullPath(source);
        if (!File.Exists(full)) throw new FileNotFoundException("Backup legado não encontrado.", full);

        var before = await Hash(full, ct);
        await using var c = await OpenReadOnly(full, ct);
        var existing = await TableNames(c, ct);
        var plans = new List<LegacyEntityPlan>();
        var conflicts = new List<string>();

        foreach (var entity in Tables.Keys)
        {
            var table = FindTable(existing, entity);
            if (table is null)
            {
                plans.Add(new(entity, null, 0, 0, 0, 0, 0));
                continue;
            }

            var rows = await Rows(c, table, ct);
            long ignored = 0;
            long duplicateCount = 0;
            decimal financial = 0;
            decimal stock = 0;

            if (entity == "products")
            {
                var effectiveCodes = rows
                    .Select((r, i) => EffectiveProductCode(r, i))
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .ToArray();
                var bars = rows
                    .Select(x => Text(x, "barcode", "codigo_barras", "ean", "cod_barras"))
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .ToArray();

                ignored = rows.Select((r, i) => (r, i)).LongCount(x => string.IsNullOrWhiteSpace(StableLegacyKey(x.r, x.i)) || string.IsNullOrWhiteSpace(Text(x.r, "name", "nome", "descricao")));
                duplicateCount = DuplicateGroups(effectiveCodes) + DuplicateGroups(bars);
                var missingNativeCodes = rows.LongCount(x => string.IsNullOrWhiteSpace(Text(x, "internal_code", "codigo", "code", "cod_produto", "sku")));
                stock = rows.Sum(x => Number(x, "stock", "estoque", "quantidade", "stock_qty"));

                if (missingNativeCodes > 0)
                    conflicts.Add($"products: {missingNativeCodes} produto(s) sem código interno; será gerado código LEGACY estável, sem perder o produto.");
                if (duplicateCount > 0)
                    conflicts.Add($"products: {duplicateCount} grupo(s) de código/barra duplicado(s); os produtos serão preservados com identificador alternativo e o conflito ficará auditado.");
            }

            if (entity is "sales" or "credit" or "purchases" or "cash")
                financial = rows.Sum(x => entity switch
                {
                    "sales" => Money(x, "total", "valor_total", "valor", "total_cents"),
                    "credit" => Money(x, "total", "valor", "saldo", "balance", "total_cents", "balance_cents"),
                    "purchases" => Money(x, "total", "valor_total", "valor", "total_cents"),
                    "cash" => Money(x, "amount", "valor", "amount_cents"),
                    _ => 0
                });

            var already = await ExistingCount(entity, ct);
            plans.Add(new(entity, table, rows.Count, Math.Max(0, rows.Count - ignored), already, duplicateCount, ignored, financial, stock));
        }

        await c.DisposeAsync();
        var after = await Hash(full, ct);
        if (!string.Equals(before, after, StringComparison.OrdinalIgnoreCase))
            throw new IOException("O backup original foi alterado durante o dry-run.");

        return new(full, "SQLite", before, after, plans, conflicts, true, false);
    }

    public Task<LegacyImportResult> ImportTestAsync(string source, CancellationToken ct = default) => ImportAsync(source, ct);

    public async Task<LegacyImportResult> ImportAsync(string source, CancellationToken ct = default)
    {
        var plan = await DryRunAsync(source, ct);
        if (!plan.SourcePreserved) throw new IOException("Hash da origem divergente.");

        target.Migrate();
        await using var dest = target.Open();
        await using var txBase = await dest.BeginTransactionAsync(ct);
        var tx = (SqliteTransaction)txBase;
        await EnsureTracking(dest, tx, ct);

        if (await Imported(dest, tx, plan.Sha256Before, ct))
        {
            await tx.RollbackAsync(ct);
            var currentStock = await Stock(dest, ct);
            return new(plan.Sha256Before, true, new Dictionary<string, long>(), target.IntegrityCheck(), currentStock, currentStock, plan.Entities.Sum(x => x.FinancialTotal));
        }

        var stockBefore = await Stock(dest, tx, ct);
        var imported = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);

        try
        {
            await using var src = await OpenReadOnly(plan.Source, ct);
            var names = await TableNames(src, ct);

            var productMap = await ImportProducts(src, names, dest, tx, plan.Sha256Before, ct);
            imported["products"] = productMap.Count;

            var customerMap = await ImportCustomers(src, names, dest, tx, plan.Sha256Before, ct);
            imported["customers"] = customerMap.Count;

            var supplierMap = await ImportSuppliers(src, names, dest, tx, plan.Sha256Before, ct);
            imported["suppliers"] = supplierMap.Count;

            var cashSessionMap = await ImportCashSessions(src, names, dest, tx, plan.Sha256Before, ct);
            imported["cash_sessions"] = cashSessionMap.Count;

            var salesMap = await ImportSales(src, names, dest, tx, plan.Sha256Before, customerMap, cashSessionMap, ct);
            imported["sales"] = salesMap.Count;

            imported["sale_items"] = await ImportSaleItems(src, names, dest, tx, plan.Sha256Before, productMap, salesMap, ct);
            imported["payments"] = await ImportPayments(src, names, dest, tx, plan.Sha256Before, salesMap, ct);

            var creditMap = await ImportCredits(src, names, dest, tx, plan.Sha256Before, customerMap, salesMap, ct);
            imported["credit"] = creditMap.Count;
            imported["credit_payments"] = await ImportCreditPayments(src, names, dest, tx, plan.Sha256Before, creditMap, ct);

            var purchaseMap = await ImportPurchases(src, names, dest, tx, plan.Sha256Before, supplierMap, ct);
            imported["purchases"] = purchaseMap.Count;
            imported["purchase_items"] = await ImportPurchaseItems(src, names, dest, tx, plan.Sha256Before, purchaseMap, productMap, ct);

            imported["cash"] = await ImportCashMovements(src, names, dest, tx, plan.Sha256Before, cashSessionMap, ct);
            imported["stock_movements"] = await ImportStockMovements(src, names, dest, tx, plan.Sha256Before, productMap, ct);

            // Nada do arquivo antigo fica invisível: tabelas não representadas pelo modelo atual
            // são arquivadas em JSON, dentro da mesma transação, para auditoria/migração futura.
            imported["raw_records"] = await ArchiveLegacyRows(src, names, dest, tx, plan.Sha256Before, ct);

            if (!string.Equals(await Hash(plan.Source, ct), plan.Sha256Before, StringComparison.OrdinalIgnoreCase))
                throw new IOException("O backup original foi alterado durante a importação.");

            var integrityInsideTransaction = await Integrity(dest, tx, ct);
            if (!string.Equals(integrityInsideTransaction, "ok", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Falha de integridade antes do commit: {integrityInsideTransaction}");

            if (await ForeignKeyViolations(dest, tx, ct) > 0)
                throw new InvalidDataException("A importação gerou vínculos inválidos. Rollback obrigatório.");

            await Mark(dest, tx, plan.Sha256Before, plan.Source, ct);
            await tx.CommitAsync(ct);
        }
        catch
        {
            try { await tx.RollbackAsync(ct); } catch { /* preserva a exceção original */ }
            throw;
        }

        var integrity = target.IntegrityCheck();
        if (!string.Equals(integrity, "ok", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Falha de integridade após importação.");

        return new(
            plan.Sha256Before,
            false,
            imported,
            integrity,
            stockBefore,
            await Stock(dest, ct),
            plan.Entities.Sum(x => x.FinancialTotal));
    }

    private sealed record ImportedProduct(string Id, string Code, string Name);
    private sealed record ImportedSale(string Id, decimal AmountReceived, decimal Change);

    private static async Task<Dictionary<string, ImportedProduct>> ImportProducts(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        CancellationToken ct)
    {
        var result = new Dictionary<string, ImportedProduct>(StringComparer.OrdinalIgnoreCase);
        var table = FindTable(names, "products");
        if (table is null) return result;

        var reservedCodes = await StringSet(dest, tx, "SELECT internal_code FROM products WHERE internal_code IS NOT NULL", ct);
        var reservedBars = await StringSet(dest, tx, "SELECT barcode FROM products WHERE barcode IS NOT NULL AND TRIM(barcode)<>''", ct);
        var rows = await Rows(src, table, ct);

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var old = StableLegacyKey(r, i);
            var name = Text(r, "name", "nome", "descricao");
            if (string.IsNullOrWhiteSpace(old) || string.IsNullOrWhiteSpace(name)) continue;

            var id = Id(hash, "product", old);
            var preferredCode = Text(r, "internal_code", "codigo", "code", "cod_produto", "sku");
            var code = UniqueCode(preferredCode, old, reservedCodes);

            var barcode = Text(r, "barcode", "codigo_barras", "ean", "cod_barras");
            if (!string.IsNullOrWhiteSpace(barcode) && !reservedBars.Add(barcode)) barcode = string.Empty;

            await Exec(dest, tx, """
INSERT INTO products(id,internal_code,barcode,name,description,category,brand,cost_price,sale_price,stock,minimum_stock,unit,supplier,photo_path,active)
VALUES($id,$code,$bar,$name,$description,$category,$brand,$cost,$price,$stock,$minimum,$unit,$supplier,NULL,$active)
""", ct,
                ("$id", id),
                ("$code", code),
                ("$bar", Db(barcode)),
                ("$name", name),
                ("$description", Db(Text(r, "description", "descricao_longa", "notes", "observacoes"))),
                ("$category", Db(Text(r, "category", "categoria"))),
                ("$brand", Db(Text(r, "brand", "marca"))),
                ("$cost", Money(r, "cost_price", "preco_custo", "custo", "cost_cents")),
                ("$price", Money(r, "sale_price", "preco", "preco_venda", "valor", "price_cents")),
                ("$stock", Number(r, "stock", "estoque", "quantidade", "stock_qty")),
                ("$minimum", Number(r, "minimum_stock", "estoque_minimo", "min_stock_qty")),
                ("$unit", NonEmpty(Text(r, "unit", "unidade"), "UN")),
                ("$supplier", Db(Text(r, "supplier", "fornecedor"))),
                ("$active", Bool(r, true, "active", "ativo") ? 1 : 0));

            result[old] = new(id, code, name);
        }

        return result;
    }

    private static async Task<Dictionary<string, string>> ImportCustomers(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        CancellationToken ct)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var table = FindTable(names, "customers");
        if (table is null) return result;

        var usedCpf = await StringSet(dest, tx, "SELECT cpf FROM customers WHERE cpf IS NOT NULL AND TRIM(cpf)<>''", ct);
        var usedCnpj = await StringSet(dest, tx, "SELECT cnpj FROM customers WHERE cnpj IS NOT NULL AND TRIM(cnpj)<>''", ct);
        var rows = await Rows(src, table, ct);

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var old = StableLegacyKey(r, i);
            var name = Text(r, "name", "nome", "razao_social");
            if (string.IsNullOrWhiteSpace(old) || string.IsNullOrWhiteSpace(name)) continue;

            var id = Id(hash, "customer", old);
            var document = Text(r, "document", "tax_id", "cpf_cnpj", "cpf", "cnpj");
            var digits = Digits(document);
            string? cpf = digits.Length == 11 && usedCpf.Add(digits) ? digits : null;
            string? cnpj = digits.Length == 14 && usedCnpj.Add(digits) ? digits : null;

            await Exec(dest, tx, """
INSERT INTO customers(id,name,tax_id,phone,whatsapp,address,notes,active,cpf,cnpj,email,postal_code,number,complement,district,city,state)
VALUES($id,$name,$tax,$phone,$wa,$address,$notes,$active,$cpf,$cnpj,$email,$postal,$number,$complement,$district,$city,$state)
""", ct,
                ("$id", id), ("$name", name), ("$tax", Db(document)),
                ("$phone", Db(Text(r, "phone", "telefone", "celular"))),
                ("$wa", Db(Text(r, "whatsapp", "telefone_whatsapp"))),
                ("$address", Db(Text(r, "address", "endereco"))),
                ("$notes", Db(Text(r, "notes", "observacoes"))),
                ("$active", Bool(r, true, "active", "ativo") ? 1 : 0),
                ("$cpf", Db(cpf)), ("$cnpj", Db(cnpj)),
                ("$email", Db(Text(r, "email"))),
                ("$postal", Db(Text(r, "zip_code", "postal_code", "cep"))),
                ("$number", Db(Text(r, "address_number", "numero"))),
                ("$complement", Db(Text(r, "complement", "complemento"))),
                ("$district", Db(Text(r, "neighborhood", "district", "bairro"))),
                ("$city", Db(Text(r, "city", "cidade"))),
                ("$state", Db(Text(r, "state", "uf"))));

            result[old] = id;
        }

        return result;
    }

    private static async Task<Dictionary<string, string>> ImportSuppliers(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        CancellationToken ct)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var table = FindTable(names, "suppliers");
        if (table is null) return result;
        var rows = await Rows(src, table, ct);

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var old = StableLegacyKey(r, i);
            var name = Text(r, "name", "nome", "razao_social", "trade_name", "nome_fantasia");
            if (string.IsNullOrWhiteSpace(old) || string.IsNullOrWhiteSpace(name)) continue;
            var id = Id(hash, "supplier", old);
            await Exec(dest, tx,
                "INSERT INTO suppliers(id,name,tax_id,phone,notes,active) VALUES($id,$name,$tax,$phone,$notes,$active)", ct,
                ("$id", id), ("$name", name),
                ("$tax", Db(Text(r, "document", "tax_id", "cpf_cnpj", "cnpj", "cpf"))),
                ("$phone", Db(Text(r, "phone", "telefone"))),
                ("$notes", Db(Text(r, "notes", "observacoes"))),
                ("$active", Bool(r, true, "active", "ativo") ? 1 : 0));
            result[old] = id;
        }

        return result;
    }

    private static async Task<Dictionary<string, string>> ImportCashSessions(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        CancellationToken ct)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var table = FindTable(names, "cash_sessions");
        if (table is null) return result;
        var rows = await Rows(src, table, ct);

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var old = StableLegacyKey(r, i);
            if (string.IsNullOrWhiteSpace(old)) continue;
            var id = Id(hash, "cash-session", old);
            var opSource = NonEmpty(Text(r, "operator_id", "operator_name", "operador", "user_name"), "LEGACY");
            var operatorId = Guid.TryParse(opSource, out var parsed) ? parsed.ToString() : Id(hash, "operator", opSource);
            var openedAt = DateText(r, "opened_at", "aberto_em", "data_abertura", "created_at") ?? DateTimeOffset.Now.ToString("O");
            var closedAt = DateText(r, "closed_at", "fechado_em", "data_fechamento");
            var informed = MoneyNullable(r, "counted_amount_cents", "informed_total", "valor_informado", "fechamento_cents");

            await Exec(dest, tx,
                "INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount,closed_at,informed_total) VALUES($id,$op,$opened,$opening,$closed,$informed)", ct,
                ("$id", id), ("$op", operatorId), ("$opened", openedAt),
                ("$opening", Money(r, "opening_amount", "valor_abertura", "opening_amount_cents")),
                ("$closed", (object?)closedAt ?? DBNull.Value),
                ("$informed", informed is null ? DBNull.Value : informed.Value));
            result[old] = id;
        }

        return result;
    }

    private static async Task<Dictionary<string, ImportedSale>> ImportSales(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, string> customers,
        Dictionary<string, string> cashSessions,
        CancellationToken ct)
    {
        var result = new Dictionary<string, ImportedSale>(StringComparer.OrdinalIgnoreCase);
        var table = FindTable(names, "sales");
        if (table is null) return result;

        var usedNumbers = await LongSet(dest, tx, "SELECT number FROM sales", ct);
        var rows = await Rows(src, table, ct);

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var old = StableLegacyKey(r, i);
            if (string.IsNullOrWhiteSpace(old)) continue;

            var id = Id(hash, "sale", old);
            var number = ReserveNumber(BusinessNumber(r, "sale_number", "numero", "number", "codigo"), hash, "sale|" + old, usedNumbers);
            var customerOld = Text(r, "customer_id", "cliente_id", "cod_cliente");
            var cashOld = Text(r, "cash_session_id", "sessao_caixa_id", "id_caixa");

            if (!cashSessions.TryGetValue(cashOld, out var cashId))
            {
                var fallbackKey = string.IsNullOrWhiteSpace(cashOld) ? "legacy-default" : cashOld;
                cashId = Id(hash, "cash-session", fallbackKey);
                if (!cashSessions.ContainsKey(fallbackKey))
                {
                    await Exec(dest, tx,
                        "INSERT OR IGNORE INTO cash_sessions(id,operator_id,opened_at,opening_amount,closed_at,informed_total) VALUES($id,$op,$opened,0,$closed,NULL)", ct,
                        ("$id", cashId),
                        ("$op", Id(hash, "operator", "LEGACY")),
                        ("$opened", DateText(r, "created_at", "data", "data_venda") ?? DateTimeOffset.Now.ToString("O")),
                        ("$closed", DateText(r, "created_at", "data", "data_venda") ?? DateTimeOffset.Now.ToString("O")));
                    cashSessions[fallbackKey] = cashId;
                }
            }

            var operatorText = NonEmpty(Text(r, "operator_id", "operator_name", "operador", "created_by", "user_name"), "LEGACY");
            var operatorId = Guid.TryParse(operatorText, out var parsed) ? parsed.ToString() : Id(hash, "operator", operatorText);
            var status = NormalizeSaleStatus(Text(r, "status"));
            var amountReceived = Money(r, "amount_received", "valor_recebido", "amount_received_cents");
            var change = Money(r, "change", "troco", "change_cents");

            await Exec(dest, tx, """
INSERT INTO sales(id,number,created_at,operator_id,customer_id,cash_session_id,discount,total,status,fiscal_status)
VALUES($id,$number,$at,$op,$customer,$cash,$discount,$total,$status,'NotRequested')
""", ct,
                ("$id", id), ("$number", number),
                ("$at", DateText(r, "created_at", "data", "data_venda") ?? DateTimeOffset.Now.ToString("O")),
                ("$op", operatorId),
                ("$customer", customers.TryGetValue(customerOld, out var customerId) ? customerId : DBNull.Value),
                ("$cash", cashId),
                ("$discount", Money(r, "discount", "desconto", "discount_cents")),
                ("$total", Money(r, "total", "valor_total", "valor", "total_cents")),
                ("$status", status));

            result[old] = new(id, amountReceived, change);
        }

        return result;
    }

    private static async Task<long> ImportSaleItems(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, ImportedProduct> products,
        IReadOnlyDictionary<string, ImportedSale> sales,
        CancellationToken ct)
    {
        var table = FindTable(names, "sale_items");
        if (table is null) return 0;
        var rows = await Rows(src, table, ct);
        long count = 0;

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var oldSale = Text(r, "sale_id", "venda_id", "id_venda");
            var oldProduct = Text(r, "product_id", "produto_id", "codigo_produto", "cod_produto");
            if (!sales.TryGetValue(oldSale, out var sale)) continue;
            ImportedProduct product;
            if (string.IsNullOrWhiteSpace(oldProduct))
                product = new("00000000-0000-0000-0000-000000000001", "DIVERSOS", "DIVERSOS");
            else if (products.TryGetValue(oldProduct, out var mappedProduct))
                product = mappedProduct;
            else
                continue;

            var qty = Number(r, "quantity", "quantidade", "qtd");
            if (qty <= 0) continue;
            var price = Money(r, "unit_price", "preco_unitario", "preco", "valor", "unit_price_cents");
            var subtotal = Money(r, "subtotal", "line_total", "valor_total", "line_total_cents");
            if (subtotal == 0) subtotal = decimal.Round(qty * price, 2, MidpointRounding.AwayFromZero);

            await Exec(dest, tx,
                "INSERT INTO sale_items(id,sale_id,product_id,code,name,quantity,unit_price,subtotal) VALUES($id,$sale,$product,$code,$name,$qty,$price,$subtotal)", ct,
                ("$id", Id(hash, "sale-item", StableLegacyKey(r, i))),
                ("$sale", sale.Id), ("$product", product.Id), ("$code", product.Code),
                ("$name", NonEmpty(Text(r, "name", "nome", "descricao", "product_name"), product.Name)),
                ("$qty", qty), ("$price", price), ("$subtotal", subtotal));
            count++;
        }

        return count;
    }

    private static async Task<long> ImportPayments(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, ImportedSale> sales,
        CancellationToken ct)
    {
        var table = FindTable(names, "payments");
        if (table is null) return 0;
        var rows = await Rows(src, table, ct);
        long count = 0;

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var oldSale = Text(r, "sale_id", "venda_id", "id_venda");
            if (!sales.TryGetValue(oldSale, out var sale)) continue;

            var method = NormalizePayment(Text(r, "method", "forma_pagamento", "tipo"), Text(r, "card_type", "tipo_cartao"));
            var amount = Money(r, "amount", "valor", "amount_cents");
            var received = method == "Cash" ? (sale.AmountReceived > 0 ? sale.AmountReceived : amount) : (decimal?)null;
            var change = method == "Cash" ? sale.Change : 0m;

            await Exec(dest, tx,
                "INSERT INTO payments(id,sale_id,method,amount,received,change_amount) VALUES($id,$sale,$method,$amount,$received,$change)", ct,
                ("$id", Id(hash, "payment", StableLegacyKey(r, i))),
                ("$sale", sale.Id), ("$method", method), ("$amount", amount),
                ("$received", received is null ? DBNull.Value : received.Value), ("$change", change));
            count++;
        }

        return count;
    }

    private static async Task<Dictionary<string, string>> ImportCredits(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, string> customers,
        IReadOnlyDictionary<string, ImportedSale> sales,
        CancellationToken ct)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var table = FindTable(names, "credit");
        if (table is null) return result;

        var dueByAccount = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var installmentsTable = FindTable(names, "credit_installments");
        if (installmentsTable is not null)
        {
            foreach (var row in await Rows(src, installmentsTable, ct))
            {
                var account = Text(row, "credit_account_id", "account_id", "crediario_id", "conta_id");
                var due = DateText(row, "due_date", "due_at", "vencimento");
                if (string.IsNullOrWhiteSpace(account) || string.IsNullOrWhiteSpace(due)) continue;
                if (!dueByAccount.TryGetValue(account, out var previous) || string.CompareOrdinal(due, previous) < 0)
                    dueByAccount[account] = due;
            }
        }

        var rows = await Rows(src, table, ct);
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var old = StableLegacyKey(r, i);
            var customerOld = Text(r, "customer_id", "cliente_id", "cod_cliente");
            var saleOld = Text(r, "sale_id", "venda_id", "id_venda");
            if (!customers.TryGetValue(customerOld, out var customerId) || !sales.TryGetValue(saleOld, out var sale)) continue;

            var id = Id(hash, "credit", old);
            var balance = Money(r, "balance", "saldo", "valor", "balance_cents");
            var original = Money(r, "original_amount", "total", "valor_total", "total_cents");
            if (original <= 0) original = balance;
            var installments = (int)Math.Max(1, Number(r, "installments", "parcelas", "installment_count"));
            var status = NormalizeCreditStatus(Text(r, "status"), original, balance);
            var createdAt = DateText(r, "created_at", "data", "data_criacao") ?? DateTimeOffset.Now.ToString("O");
            var dueAt = dueByAccount.TryGetValue(old, out var due)
                ? due
                : DateText(r, "due_at", "due_date", "vencimento") ?? DateTimeOffset.Parse(createdAt).AddDays(30).ToString("O");

            await Exec(dest, tx, """
INSERT INTO credit_accounts(id,customer_id,sale_id,original_amount,balance,created_at,due_at,status,installments,notes)
VALUES($id,$customer,$sale,$original,$balance,$created,$due,$status,$installments,$notes)
""", ct,
                ("$id", id), ("$customer", customerId), ("$sale", sale.Id),
                ("$original", original), ("$balance", balance), ("$created", createdAt),
                ("$due", dueAt), ("$status", status), ("$installments", installments),
                ("$notes", Db(Text(r, "notes", "observacoes"))));

            // Mantém compatibilidade com relatórios que ainda consultam credit_entries.
            await Exec(dest, tx,
                "INSERT OR IGNORE INTO credit_entries(id,customer_id,sale_id,type,amount,due_at,created_at,reason) VALUES($id,$customer,$sale,'Debit',$amount,$due,$created,'IMPORTAÇÃO LEGADO')", ct,
                ("$id", Id(hash, "credit-entry", old)), ("$customer", customerId), ("$sale", sale.Id),
                ("$amount", original), ("$due", dueAt), ("$created", createdAt));

            result[old] = id;
        }

        return result;
    }

    private static async Task<long> ImportCreditPayments(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, string> accounts,
        CancellationToken ct)
    {
        var table = FindTable(names, "credit_payments");
        if (table is null) return 0;
        var rows = await Rows(src, table, ct);
        long count = 0;

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var oldAccount = Text(r, "credit_account_id", "account_id", "crediario_id", "conta_id");
            if (!accounts.TryGetValue(oldAccount, out var accountId)) continue;
            var method = NormalizePayment(Text(r, "method", "forma_pagamento", "tipo"), null);
            var amount = Money(r, "amount", "valor", "amount_cents");
            if (Bool(r, false, "is_reversal", "estorno")) amount = -Math.Abs(amount);
            var opText = NonEmpty(Text(r, "user_name", "operator_name", "operador"), "LEGACY");
            var operatorId = Guid.TryParse(opText, out var parsed) ? parsed.ToString() : Id(hash, "operator", opText);

            await Exec(dest, tx,
                "INSERT INTO credit_receipts(id,account_id,amount,method,operator_id,created_at,notes) VALUES($id,$account,$amount,$method,$operator,$at,$notes)", ct,
                ("$id", Id(hash, "credit-payment", StableLegacyKey(r, i))),
                ("$account", accountId), ("$amount", amount), ("$method", method),
                ("$operator", operatorId),
                ("$at", DateText(r, "paid_at", "created_at", "data") ?? DateTimeOffset.Now.ToString("O")),
                ("$notes", Db(Text(r, "notes", "observacoes"))));
            count++;
        }

        return count;
    }

    private static async Task<Dictionary<string, string>> ImportPurchases(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, string> suppliers,
        CancellationToken ct)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var table = FindTable(names, "purchases");
        if (table is null) return result;
        var usedNumbers = await LongSet(dest, tx, "SELECT number FROM purchases", ct);
        var rows = await Rows(src, table, ct);

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var old = StableLegacyKey(r, i);
            var supplierOld = Text(r, "supplier_id", "fornecedor_id", "cod_fornecedor");
            if (!suppliers.TryGetValue(supplierOld, out var supplierId)) continue;
            var id = Id(hash, "purchase", old);
            var number = ReserveNumber(BusinessNumber(r, "purchase_number", "numero", "number", "codigo"), hash, "purchase|" + old, usedNumbers);

            await Exec(dest, tx,
                "INSERT INTO purchases(id,number,supplier_id,created_at,total,document_number,notes) VALUES($id,$number,$supplier,$at,$total,$document,$notes)", ct,
                ("$id", id), ("$number", number), ("$supplier", supplierId),
                ("$at", DateText(r, "purchase_date", "created_at", "data") ?? DateTimeOffset.Now.ToString("O")),
                ("$total", Money(r, "total", "valor_total", "valor", "total_cents")),
                ("$document", Db(Text(r, "document_number", "numero_documento", "nota"))),
                ("$notes", Db(Text(r, "notes", "observacoes"))));
            result[old] = id;
        }

        return result;
    }

    private static async Task<long> ImportPurchaseItems(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, string> purchases,
        IReadOnlyDictionary<string, ImportedProduct> products,
        CancellationToken ct)
    {
        var table = FindTable(names, "purchase_items");
        if (table is null) return 0;
        var rows = await Rows(src, table, ct);
        long count = 0;

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var oldPurchase = Text(r, "purchase_id", "compra_id", "id_compra");
            var oldProduct = Text(r, "product_id", "produto_id", "id_produto");
            if (!purchases.TryGetValue(oldPurchase, out var purchaseId) || !products.TryGetValue(oldProduct, out var product)) continue;
            var qty = Number(r, "quantity", "quantidade", "qtd");
            var unitCost = Money(r, "unit_cost", "custo_unitario", "unit_cost_cents");
            var subtotal = Money(r, "subtotal", "line_total", "line_total_cents");
            if (subtotal == 0) subtotal = qty * unitCost;

            await Exec(dest, tx,
                "INSERT INTO purchase_items(id,purchase_id,product_id,code,name,quantity,unit_cost,subtotal) VALUES($id,$purchase,$product,$code,$name,$qty,$cost,$subtotal)", ct,
                ("$id", Id(hash, "purchase-item", StableLegacyKey(r, i))),
                ("$purchase", purchaseId), ("$product", product.Id), ("$code", product.Code),
                ("$name", NonEmpty(Text(r, "product_name", "name", "nome"), product.Name)),
                ("$qty", qty), ("$cost", unitCost), ("$subtotal", subtotal));
            count++;
        }

        return count;
    }

    private static async Task<long> ImportCashMovements(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, string> sessions,
        CancellationToken ct)
    {
        var table = FindTable(names, "cash");
        if (table is null) return 0;
        var rows = await Rows(src, table, ct);
        long count = 0;

        // O banco novo usa cash_movements.reason para separar Dinheiro/PIX/Débito/Crédito
        // no fechamento. No legado, essa informação fica em payment_method e, para cartão,
        // o detalhe Débito/Crédito fica em sale_payments.card_type.
        var salePaymentMethods = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var paymentsTable = FindTable(names, "payments");
        if (paymentsTable is not null)
        {
            foreach (var paymentRow in await Rows(src, paymentsTable, ct))
            {
                var saleKey = Text(paymentRow, "sale_id", "venda_id", "id_venda");
                if (string.IsNullOrWhiteSpace(saleKey)) continue;
                salePaymentMethods[saleKey] = NormalizePayment(
                    Text(paymentRow, "method", "forma_pagamento", "tipo"),
                    Text(paymentRow, "card_type", "tipo_cartao"));
            }
        }

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var oldSession = Text(r, "cash_session_id", "session_id", "sessao_caixa_id");
            if (!sessions.TryGetValue(oldSession, out var sessionId)) continue;
            var rawType = Text(r, "movement_type", "type", "tipo");
            var type = NormalizeCashMovement(rawType);
            var payment = Text(r, "payment_method", "forma_pagamento");
            var origin = Text(r, "reference_id", "origin_id", "referencia_id");

            string reason;
            if (type == "Sale")
            {
                // Prioriza o pagamento da venda para não transformar Débito em Crédito.
                reason = salePaymentMethods.TryGetValue(origin, out var saleMethod)
                    ? saleMethod
                    : NormalizePayment(payment, null);
            }
            else
            {
                reason = NonEmpty(Text(r, "reason", "motivo"), $"LEGADO: {rawType}");
            }

            await Exec(dest, tx,
                "INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at) VALUES($id,$session,$type,$amount,$origin,$reason,$at)", ct,
                ("$id", Id(hash, "cash-movement", StableLegacyKey(r, i))),
                ("$session", sessionId), ("$type", type),
                ("$amount", Money(r, "amount", "valor", "amount_cents")),
                ("$origin", Db(origin)),
                ("$reason", reason),
                ("$at", DateText(r, "created_at", "data") ?? DateTimeOffset.Now.ToString("O")));
            count++;
        }

        return count;
    }

    private static async Task<long> ImportStockMovements(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        IReadOnlyDictionary<string, ImportedProduct> products,
        CancellationToken ct)
    {
        var table = FindTable(names, "stock_movements");
        if (table is null) return 0;
        var rows = await Rows(src, table, ct);
        long count = 0;

        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var oldProduct = Text(r, "product_id", "produto_id", "id_produto");
            if (!products.TryGetValue(oldProduct, out var product)) continue;
            var rawType = Text(r, "movement_type", "type", "tipo");
            var qty = Number(r, "quantity_delta", "quantity", "quantidade", "qtd");
            var type = NormalizeStockMovement(rawType);
            var reason = NonEmpty(Text(r, "reason", "motivo", "note", "observacao"), $"LEGADO: {rawType}");

            await Exec(dest, tx,
                "INSERT INTO stock_movements(id,product_id,type,quantity,origin_id,reason,created_at) VALUES($id,$product,$type,$qty,$origin,$reason,$at)", ct,
                ("$id", Id(hash, "stock-movement", StableLegacyKey(r, i))),
                ("$product", product.Id), ("$type", type), ("$qty", qty),
                ("$origin", NonEmpty(Text(r, "reference_id", "origin_id", "referencia_id"), StableLegacyKey(r, i))),
                ("$reason", reason),
                ("$at", DateText(r, "created_at", "data") ?? DateTimeOffset.Now.ToString("O")));
            count++;
        }

        return count;
    }

    private static async Task<long> ArchiveLegacyRows(
        SqliteConnection src,
        HashSet<string> names,
        SqliteConnection dest,
        SqliteTransaction tx,
        string hash,
        CancellationToken ct)
    {
        long count = 0;
        foreach (var table in names.OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            if (table.StartsWith("sqlite_", StringComparison.OrdinalIgnoreCase)) continue;
            var rows = await Rows(src, table, ct);
            for (var i = 0; i < rows.Count; i++)
            {
                var row = rows[i];
                var key = StableLegacyKey(row, i);
                var json = JsonSerializer.Serialize(row);
                await Exec(dest, tx, """
INSERT OR IGNORE INTO legacy_raw_records(id,source_sha256,table_name,legacy_key,json_data,imported_at)
VALUES($id,$hash,$table,$key,$json,$at)
""", ct,
                    ("$id", Id(hash, "raw|" + table, key)), ("$hash", hash), ("$table", table),
                    ("$key", key), ("$json", json), ("$at", DateTimeOffset.Now.ToString("O")));
                count++;
            }
        }
        return count;
    }

    private async Task<long> ExistingCount(string entity, CancellationToken ct)
    {
        var table = entity switch
        {
            "credit" => "credit_accounts",
            "credit_payments" => "credit_receipts",
            "payments" => "payments",
            "cash" => "cash_movements",
            _ => entity
        };
        try
        {
            await using var c = target.Open();
            await using var q = c.CreateCommand();
            q.CommandText = $"SELECT COUNT(*) FROM {table}";
            return Convert.ToInt64(await q.ExecuteScalarAsync(ct));
        }
        catch
        {
            return 0;
        }
    }

    private static string? FindTable(HashSet<string> existing, string entity) =>
        Tables[entity].FirstOrDefault(existing.Contains);

    private static long DuplicateGroups(IEnumerable<string> values) =>
        values.Where(x => !string.IsNullOrWhiteSpace(x))
            .GroupBy(x => x.Trim(), StringComparer.OrdinalIgnoreCase)
            .LongCount(g => g.Count() > 1);

    private static string EffectiveProductCode(Dictionary<string, object?> row, int index)
    {
        var native = Text(row, "internal_code", "codigo", "code", "cod_produto", "sku");
        return !string.IsNullOrWhiteSpace(native) ? native : $"LEGACY-{StableLegacyKey(row, index)}";
    }

    private static string UniqueCode(string preferred, string legacyKey, HashSet<string> reserved)
    {
        var baseCode = string.IsNullOrWhiteSpace(preferred) ? $"LEGACY-{legacyKey}" : preferred.Trim();
        if (reserved.Add(baseCode)) return baseCode;
        var alt = $"LEGACY-{legacyKey}";
        var suffix = 1;
        while (!reserved.Add(alt)) alt = $"LEGACY-{legacyKey}-{suffix++}";
        return alt;
    }

    private static string StableLegacyKey(Dictionary<string, object?> row, int index)
    {
        var value = Text(row, "id", "legacy_id", "codigo", "code", "internal_code", "sku", "numero", "number", "sale_number", "purchase_number");
        return string.IsNullOrWhiteSpace(value) ? $"ROW-{index:000000}" : value;
    }

    private static string NormalizeSaleStatus(string value)
    {
        var x = value.Trim().ToLowerInvariant();
        return x switch
        {
            "cancelled" or "canceled" or "cancelada" or "cancelado" => "Cancelled",
            _ => "Completed"
        };
    }

    private static string NormalizeCreditStatus(string value, decimal original, decimal balance)
    {
        var x = value.Trim().ToLowerInvariant();
        if (x is "cancelado" or "cancelada" or "cancelled" or "canceled") return "Cancelled";
        if (x is "quitado" or "quitada" or "paid" || balance <= 0) return "Paid";
        if (balance > 0 && original > 0 && balance < original) return "Partial";
        return "Open";
    }

    private static string NormalizePayment(string value, string? cardType)
    {
        var x = value.Trim().ToLowerInvariant();
        var card = (cardType ?? string.Empty).Trim().ToLowerInvariant();
        if (x.Contains("pix")) return "Pix";
        if (x.Contains("credi") && !x.Contains("cart")) return "StoreCredit";
        if (x.Contains("din") || x.Contains("cash")) return "Cash";
        if (x.Contains("deb") || card.Contains("deb")) return "Debit";
        if (x.Contains("cred") || card.Contains("cred")) return "Credit";
        if (x.Contains("cart")) return card.Contains("deb") ? "Debit" : "Credit";
        return "Cash";
    }

    private static string NormalizeCashMovement(string value)
    {
        var x = value.Trim().ToLowerInvariant();
        if (x.Contains("abert")) return "Opening";
        if (x.Contains("supr")) return "Supply";
        if (x.Contains("sang") || x.Contains("retir")) return "Withdrawal";
        if (x.Contains("receb") && x.Contains("credi")) return "StoreCreditReceipt";
        if (x.Contains("cancel")) return "Cancellation";
        return "Sale";
    }

    private static string NormalizeStockMovement(string value)
    {
        var x = value.Trim().ToLowerInvariant();
        if (x.Contains("sale_cancel") || x.Contains("cancel")) return "Cancellation";
        if (x.Contains("sale") || x.Contains("venda")) return "Sale";
        if (x.Contains("purchase") || x.Contains("compra")) return "Purchase";
        if (x.Contains("return") || x.Contains("devol")) return "Return";
        if (x.Contains("inventory") || x.Contains("invent")) return "Inventory";
        return "Adjustment";
    }

    private static string BusinessNumber(Dictionary<string, object?> row, params string[] names)
    {
        var raw = Text(row, names);
        if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)) return raw;
        if (!string.IsNullOrWhiteSpace(raw))
        {
            var end = raw.Length - 1;
            while (end >= 0 && char.IsDigit(raw[end])) end--;
            var trailing = raw[(end + 1)..];
            if (!string.IsNullOrWhiteSpace(trailing) && long.TryParse(trailing, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)) return trailing;
        }
        return Text(row, "id", "legacy_id");
    }

    private static long ReserveNumber(string source, string hash, string stableKey, HashSet<long> used)
    {
        if (long.TryParse(source, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0 && used.Add(parsed))
            return parsed;
        var candidate = StableNumber(hash, stableKey);
        while (!used.Add(candidate)) candidate++;
        return candidate;
    }

    private static async Task<HashSet<string>> StringSet(SqliteConnection c, SqliteTransaction tx, string sql, CancellationToken ct)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var q = c.CreateCommand();
        q.Transaction = tx;
        q.CommandText = sql;
        await using var r = await q.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) if (!r.IsDBNull(0)) set.Add(Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture) ?? string.Empty);
        return set;
    }

    private static async Task<HashSet<long>> LongSet(SqliteConnection c, SqliteTransaction tx, string sql, CancellationToken ct)
    {
        var set = new HashSet<long>();
        await using var q = c.CreateCommand();
        q.Transaction = tx;
        q.CommandText = sql;
        await using var r = await q.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) if (!r.IsDBNull(0)) set.Add(Convert.ToInt64(r.GetValue(0), CultureInfo.InvariantCulture));
        return set;
    }

    private static async Task<SqliteConnection> OpenReadOnly(string file, CancellationToken ct)
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = file,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private
        }.ToString());
        await c.OpenAsync(ct);
        await using var q = c.CreateCommand();
        q.CommandText = "PRAGMA query_only=ON";
        await q.ExecuteNonQueryAsync(ct);
        return c;
    }

    private static async Task<HashSet<string>> TableNames(SqliteConnection c, CancellationToken ct)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var q = c.CreateCommand();
        q.CommandText = "SELECT name FROM sqlite_master WHERE type='table'";
        await using var r = await q.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) set.Add(r.GetString(0));
        return set;
    }

    private static async Task<List<Dictionary<string, object?>>> Rows(SqliteConnection c, string table, CancellationToken ct)
    {
        if (!table.All(x => char.IsLetterOrDigit(x) || x == '_')) throw new InvalidDataException("Tabela inválida.");
        var rows = new List<Dictionary<string, object?>>();
        await using var q = c.CreateCommand();
        q.CommandText = $"SELECT * FROM \"{table}\"";
        await using var r = await q.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < r.FieldCount; i++) row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    private static string Text(Dictionary<string, object?> r, params string[] names)
    {
        foreach (var n in names)
            if (r.TryGetValue(n, out var v) && v is not null)
                return Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim() ?? string.Empty;
        return string.Empty;
    }

    private static string? DateText(Dictionary<string, object?> r, params string[] names)
    {
        var text = Text(r, names);
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dto)) return dto.ToString("O");
        if (DateTimeOffset.TryParse(text, new CultureInfo("pt-BR"), DateTimeStyles.AssumeLocal, out dto)) return dto.ToString("O");
        return text;
    }

    private static decimal Number(Dictionary<string, object?> r, params string[] names)
    {
        foreach (var n in names)
        {
            if (!r.TryGetValue(n, out var raw) || raw is null) continue;
            if (raw is long l) return l;
            if (raw is int i) return i;
            if (raw is double d) return Convert.ToDecimal(d, CultureInfo.InvariantCulture);
            if (raw is decimal dec) return dec;
            var s = Convert.ToString(raw, CultureInfo.InvariantCulture)?.Replace("R$", string.Empty).Trim() ?? string.Empty;
            if (decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ||
                decimal.TryParse(s, NumberStyles.Any, new CultureInfo("pt-BR"), out value)) return value;
        }
        return 0;
    }

    private static decimal Money(Dictionary<string, object?> r, params string[] names)
    {
        foreach (var n in names)
        {
            if (!r.TryGetValue(n, out var raw) || raw is null) continue;
            var value = Number(new Dictionary<string, object?> { [n] = raw }, n);
            return n.EndsWith("_cents", StringComparison.OrdinalIgnoreCase) ? value / 100m : value;
        }
        return 0;
    }

    private static decimal? MoneyNullable(Dictionary<string, object?> r, params string[] names)
    {
        foreach (var n in names)
            if (r.TryGetValue(n, out var raw) && raw is not null)
                return Money(new Dictionary<string, object?> { [n] = raw }, n);
        return null;
    }

    private static bool Bool(Dictionary<string, object?> r, bool fallback, params string[] names)
    {
        foreach (var n in names)
        {
            if (!r.TryGetValue(n, out var raw) || raw is null) continue;
            if (raw is long l) return l != 0;
            if (raw is int i) return i != 0;
            if (bool.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), out var b)) return b;
            if (int.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), out var number)) return number != 0;
        }
        return fallback;
    }

    private static string Digits(string value) => string.Concat(value.Where(char.IsDigit));
    private static string NonEmpty(string value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    private static object Db(string? value) => string.IsNullOrWhiteSpace(value) ? DBNull.Value : value;

    private static string Id(string hash, string type, string old) =>
        new Guid(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(hash + "|" + type + "|" + old))[..16]).ToString();

    private static long StableNumber(string hash, string old) =>
        Math.Abs(BitConverter.ToInt64(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(hash + old)), 0) % 800000000) + 100000000;

    private static async Task<int> Exec(
        SqliteConnection c,
        SqliteTransaction tx,
        string sql,
        CancellationToken ct,
        params (string, object?)[] args)
    {
        await using var q = c.CreateCommand();
        q.Transaction = tx;
        q.CommandText = sql;
        foreach (var (name, value) in args) q.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return await q.ExecuteNonQueryAsync(ct);
    }

    private static async Task EnsureTracking(SqliteConnection c, SqliteTransaction tx, CancellationToken ct)
    {
        await Exec(c, tx, """
CREATE TABLE IF NOT EXISTS legacy_imports(
 source_sha256 TEXT PRIMARY KEY,
 source_path TEXT NOT NULL,
 imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS legacy_raw_records(
 id TEXT PRIMARY KEY,
 source_sha256 TEXT NOT NULL,
 table_name TEXT NOT NULL,
 legacy_key TEXT NOT NULL,
 json_data TEXT NOT NULL,
 imported_at TEXT NOT NULL,
 UNIQUE(source_sha256,table_name,legacy_key)
);
CREATE INDEX IF NOT EXISTS ix_legacy_raw_source_table ON legacy_raw_records(source_sha256,table_name);
""", ct);
    }

    private static async Task<bool> Imported(SqliteConnection c, SqliteTransaction tx, string hash, CancellationToken ct)
    {
        await using var q = c.CreateCommand();
        q.Transaction = tx;
        q.CommandText = "SELECT COUNT(*) FROM legacy_imports WHERE source_sha256=$h";
        q.Parameters.AddWithValue("$h", hash);
        return Convert.ToInt64(await q.ExecuteScalarAsync(ct)) > 0;
    }

    private static Task Mark(SqliteConnection c, SqliteTransaction tx, string hash, string path, CancellationToken ct) =>
        Exec(c, tx,
            "INSERT INTO legacy_imports(source_sha256,source_path,imported_at) VALUES($h,$p,$at)", ct,
            ("$h", hash), ("$p", path), ("$at", DateTimeOffset.Now.ToString("O")));

    private static async Task<decimal> Stock(SqliteConnection c, CancellationToken ct)
    {
        await using var q = c.CreateCommand();
        q.CommandText = "SELECT COALESCE(SUM(stock),0) FROM products";
        return Convert.ToDecimal(await q.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
    }

    private static async Task<decimal> Stock(SqliteConnection c, SqliteTransaction tx, CancellationToken ct)
    {
        await using var q = c.CreateCommand();
        q.Transaction = tx;
        q.CommandText = "SELECT COALESCE(SUM(stock),0) FROM products";
        return Convert.ToDecimal(await q.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
    }

    private static async Task<string> Integrity(SqliteConnection c, SqliteTransaction tx, CancellationToken ct)
    {
        await using var q = c.CreateCommand();
        q.Transaction = tx;
        q.CommandText = "PRAGMA integrity_check";
        return Convert.ToString(await q.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) ?? "unknown";
    }

    private static async Task<long> ForeignKeyViolations(SqliteConnection c, SqliteTransaction tx, CancellationToken ct)
    {
        await using var q = c.CreateCommand();
        q.Transaction = tx;
        q.CommandText = "PRAGMA foreign_key_check";
        await using var r = await q.ExecuteReaderAsync(ct);
        long count = 0;
        while (await r.ReadAsync(ct)) count++;
        return count;
    }

    private static async Task<string> Hash(string path, CancellationToken ct)
    {
        await using var s = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        return Convert.ToHexString(await SHA256.HashDataAsync(s, ct));
    }
}
