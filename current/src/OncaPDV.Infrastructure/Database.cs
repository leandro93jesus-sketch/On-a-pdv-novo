using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Application;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record AppPaths(string Root, string Data, string Backups, string Logs, string Exports, string PrintPreview)
{
    public static AppPaths Default()
    {
        var root = Environment.GetEnvironmentVariable("ONCA_PDV_DATA_ROOT");
        if (string.IsNullOrWhiteSpace(root)) root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Onca PDV Pro");
        return new(root, Path.Combine(root, "data"), Path.Combine(root, "backups"), Path.Combine(root, "logs"),
            Path.Combine(root, "exports"), Path.Combine(root, "print-preview"));
    }
    public void EnsureCreated() { foreach (var p in new[] { Root, Data, Backups, Logs, Exports, PrintPreview }) Directory.CreateDirectory(p); }
}

public sealed class OncaDatabase(AppPaths paths)
{
    public string DatabasePath => Path.Combine(paths.Data, "onca-pdv-pro.db");
    public string ConnectionString => new SqliteConnectionStringBuilder { DataSource = DatabasePath, Mode = SqliteOpenMode.ReadWriteCreate, Cache = SqliteCacheMode.Shared }.ToString();

    public SqliteConnection Open()
    {
        paths.EnsureCreated();
        var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;";
        command.ExecuteNonQuery();
        return connection;
    }

    public void Migrate()
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = SchemaV1;
        cmd.ExecuteNonQuery();
        tx.Commit();
        MigrateV2(c);
        MigrateV3(c);
        MigrateV4(c);
        SeedDiversos();
    }
    private static void MigrateV4(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
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
INSERT OR IGNORE INTO schema_versions VALUES(4,datetime('now'));
""";
        cmd.ExecuteNonQuery();
    }

    private static void MigrateV3(SqliteConnection c)
    {
        using var cmd=c.CreateCommand();cmd.CommandText="""
CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE,supplier_id TEXT NOT NULL,created_at TEXT NOT NULL,total NUMERIC NOT NULL,document_number TEXT,notes TEXT,FOREIGN KEY(supplier_id) REFERENCES suppliers(id));
CREATE TABLE IF NOT EXISTS purchase_items(id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL,product_id TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,quantity NUMERIC NOT NULL,unit_cost NUMERIC NOT NULL,subtotal NUMERIC NOT NULL,FOREIGN KEY(purchase_id) REFERENCES purchases(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE INDEX IF NOT EXISTS ix_purchases_created ON purchases(created_at);
CREATE INDEX IF NOT EXISTS ix_purchases_supplier ON purchases(supplier_id,created_at);
INSERT OR IGNORE INTO schema_versions VALUES(3,datetime('now'));
""";cmd.ExecuteNonQuery();
    }
    private static void MigrateV2(SqliteConnection c)
    {
        foreach(var column in new[]{"cpf TEXT","cnpj TEXT","email TEXT","postal_code TEXT","number TEXT","complement TEXT","district TEXT","city TEXT","state TEXT"}){var name=column.Split(' ')[0];using var check=c.CreateCommand();check.CommandText="SELECT COUNT(*) FROM pragma_table_info('customers') WHERE name=$name";check.Parameters.AddWithValue("$name",name);if(Convert.ToInt64(check.ExecuteScalar())==0){using var alter=c.CreateCommand();alter.CommandText=$"ALTER TABLE customers ADD COLUMN {column}";alter.ExecuteNonQuery();}}
        using var cmd=c.CreateCommand();cmd.CommandText="""
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_cpf ON customers(cpf) WHERE cpf IS NOT NULL AND cpf<>'';
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_cnpj ON customers(cnpj) WHERE cnpj IS NOT NULL AND cnpj<>'';
CREATE INDEX IF NOT EXISTS ix_customers_search ON customers(name,phone,cpf,cnpj);
CREATE INDEX IF NOT EXISTS ix_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS ix_sales_customer_created ON sales(customer_id,created_at);
CREATE INDEX IF NOT EXISTS ix_payments_sale_method ON payments(sale_id,method);
CREATE TABLE IF NOT EXISTS credit_accounts(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,sale_id TEXT NOT NULL,original_amount NUMERIC NOT NULL,balance NUMERIC NOT NULL,created_at TEXT NOT NULL,due_at TEXT NOT NULL,status TEXT NOT NULL,installments INTEGER NOT NULL,notes TEXT,FOREIGN KEY(customer_id) REFERENCES customers(id),FOREIGN KEY(sale_id) REFERENCES sales(id));
CREATE TABLE IF NOT EXISTS credit_receipts(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,amount NUMERIC NOT NULL,method TEXT NOT NULL,operator_id TEXT NOT NULL,created_at TEXT NOT NULL,notes TEXT,FOREIGN KEY(account_id) REFERENCES credit_accounts(id));
CREATE INDEX IF NOT EXISTS ix_receipts_created ON credit_receipts(created_at);
INSERT OR IGNORE INTO schema_versions VALUES(2,datetime('now'));
INSERT OR IGNORE INTO customers(id,name,active) VALUES('00000000-0000-0000-0000-000000000002','CONSUMIDOR',1);
""";cmd.ExecuteNonQuery();
    }

    private void SeedDiversos()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT OR IGNORE INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES($id,'DIVERSOS','DIVERSOS',0,0,0,0,'UN',1)";
        cmd.Parameters.AddWithValue("$id", Guid.Parse("00000000-0000-0000-0000-000000000001").ToString());
        cmd.ExecuteNonQuery();
    }

    public string IntegrityCheck()
    {
        using var c = Open(); using var cmd = c.CreateCommand(); cmd.CommandText = "PRAGMA integrity_check;";
        return Convert.ToString(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) ?? "unknown";
    }

    private const string SchemaV1 = """
CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO schema_versions VALUES(1, datetime('now'));
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, internal_code TEXT NOT NULL COLLATE NOCASE UNIQUE, barcode TEXT COLLATE NOCASE UNIQUE,
 name TEXT NOT NULL, description TEXT, category TEXT, brand TEXT, cost_price NUMERIC NOT NULL CHECK(cost_price>=0), sale_price NUMERIC NOT NULL CHECK(sale_price>=0),
 stock NUMERIC NOT NULL DEFAULT 0, minimum_stock NUMERIC NOT NULL DEFAULT 0, unit TEXT NOT NULL, supplier TEXT, photo_path TEXT, active INTEGER NOT NULL,
 promotional_price NUMERIC, promotion_starts_at TEXT, promotion_ends_at TEXT);
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,name TEXT NOT NULL,tax_id TEXT,phone TEXT,whatsapp TEXT,address TEXT,notes TEXT,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS suppliers(id TEXT PRIMARY KEY,name TEXT NOT NULL,tax_id TEXT,phone TEXT,notes TEXT,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS cash_sessions(id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,opened_at TEXT NOT NULL,opening_amount NUMERIC NOT NULL,closed_at TEXT,informed_total NUMERIC);
CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE,created_at TEXT NOT NULL,operator_id TEXT NOT NULL,customer_id TEXT,
 cash_session_id TEXT NOT NULL,discount NUMERIC NOT NULL,total NUMERIC NOT NULL,status TEXT NOT NULL DEFAULT 'Completed',fiscal_status TEXT NOT NULL DEFAULT 'NotRequested',
 FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(cash_session_id) REFERENCES cash_sessions(id));
CREATE TABLE IF NOT EXISTS sale_items(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,product_id TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,quantity NUMERIC NOT NULL,unit_price NUMERIC NOT NULL,subtotal NUMERIC NOT NULL,
 FOREIGN KEY(sale_id) REFERENCES sales(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,method TEXT NOT NULL,amount NUMERIC NOT NULL,received NUMERIC,change_amount NUMERIC NOT NULL,FOREIGN KEY(sale_id) REFERENCES sales(id));
CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,type TEXT NOT NULL,quantity NUMERIC NOT NULL,origin_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS cash_movements(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,type TEXT NOT NULL,amount NUMERIC NOT NULL,origin_id TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES cash_sessions(id));
CREATE TABLE IF NOT EXISTS credit_entries(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,sale_id TEXT,type TEXT NOT NULL,amount NUMERIC NOT NULL,due_at TEXT,created_at TEXT NOT NULL,reason TEXT NOT NULL,FOREIGN KEY(customer_id) REFERENCES customers(id));
CREATE TABLE IF NOT EXISTS print_jobs(id TEXT PRIMARY KEY,sale_id TEXT,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fiscal_documents(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,status TEXT NOT NULL,environment TEXT NOT NULL,access_key TEXT,protocol TEXT,xml TEXT,error TEXT,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT NOT NULL,before_json TEXT,after_json TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL);
""";
}

public sealed class SqliteProductRepository(OncaDatabase database) : IProductRepository
{
    public async Task SaveAsync(Product p, CancellationToken ct = default)
    {
        p=p with{InternalCode=p.InternalCode.Trim().ToUpperInvariant(),Barcode=string.IsNullOrWhiteSpace(p.Barcode)?null:p.Barcode.Trim(),Name=p.Name.Trim(),Unit=p.Unit.Trim().ToUpperInvariant()};
        await using var c = database.Open(); await using var tx = await c.BeginTransactionAsync(ct);var isNew=true;
        await using(var exists=c.CreateCommand()){exists.Transaction=(SqliteTransaction)tx;exists.CommandText="SELECT COUNT(*) FROM products WHERE id=$id";exists.Parameters.AddWithValue("$id",p.Id.ToString());isNew=Convert.ToInt64(await exists.ExecuteScalarAsync(ct))==0;}
        await using var cmd = c.CreateCommand();cmd.Transaction=(SqliteTransaction)tx;
        cmd.CommandText = """
INSERT INTO products(id,internal_code,barcode,name,description,category,brand,cost_price,sale_price,stock,minimum_stock,unit,supplier,photo_path,active,promotional_price,promotion_starts_at,promotion_ends_at)
VALUES($id,$code,$bar,$name,$desc,$cat,$brand,$cost,$price,$stock,$min,$unit,$supplier,$photo,$active,$promo,$start,$end)
ON CONFLICT(id) DO UPDATE SET internal_code=excluded.internal_code,barcode=excluded.barcode,name=excluded.name,description=excluded.description,category=excluded.category,brand=excluded.brand,cost_price=excluded.cost_price,sale_price=excluded.sale_price,minimum_stock=excluded.minimum_stock,unit=excluded.unit,supplier=excluded.supplier,photo_path=excluded.photo_path,active=excluded.active,promotional_price=excluded.promotional_price,promotion_starts_at=excluded.promotion_starts_at,promotion_ends_at=excluded.promotion_ends_at
""";
        AddProductParameters(cmd, p);
        try { await cmd.ExecuteNonQueryAsync(ct);if(isNew&&p.Stock!=0){await using var movement=c.CreateCommand();movement.Transaction=(SqliteTransaction)tx;movement.CommandText="INSERT INTO stock_movements VALUES($id,$product,'Inventory',$q,$origin,'ESTOQUE INICIAL',$at)";movement.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());movement.Parameters.AddWithValue("$product",p.Id.ToString());movement.Parameters.AddWithValue("$q",p.Stock);movement.Parameters.AddWithValue("$origin",p.Id.ToString());movement.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await movement.ExecuteNonQueryAsync(ct);}await tx.CommitAsync(ct); }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        { await tx.RollbackAsync(ct);throw new DuplicateProductException("Código interno ou código de barras já cadastrado."); }
    }
    public async Task<Product?> FindAsync(string value, CancellationToken ct = default)
    {
        await using var c = database.Open(); await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT * FROM products WHERE active=1 AND (internal_code=$v OR barcode=$v OR name LIKE $like) ORDER BY CASE WHEN internal_code=$v THEN 0 WHEN barcode=$v THEN 1 WHEN name=$v COLLATE NOCASE THEN 2 WHEN name LIKE $prefix THEN 3 ELSE 4 END,internal_code LIMIT 1";
        cmd.Parameters.AddWithValue("$v", value); cmd.Parameters.AddWithValue("$like", $"%{value}%");
        cmd.Parameters.AddWithValue("$prefix", $"{value}%");
        await using var r = await cmd.ExecuteReaderAsync(ct); return await r.ReadAsync(ct) ? ReadProduct(r) : null;
    }
    public async Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct = default)
    {
        var list = new List<Product>(); await using var c = database.Open(); await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT * FROM products WHERE internal_code LIKE $q OR barcode LIKE $q OR name LIKE $q ORDER BY CASE WHEN internal_code=$exact THEN 0 WHEN barcode=$exact THEN 1 WHEN name=$exact COLLATE NOCASE THEN 2 WHEN name LIKE $prefix THEN 3 ELSE 4 END,name,internal_code LIMIT 50"; cmd.Parameters.AddWithValue("$q", $"%{term}%");cmd.Parameters.AddWithValue("$exact",term.Trim());cmd.Parameters.AddWithValue("$prefix",$"{term.Trim()}%");
        await using var r = await cmd.ExecuteReaderAsync(ct); while (await r.ReadAsync(ct)) list.Add(ReadProduct(r)); return list;
    }
    private static void AddProductParameters(SqliteCommand c, Product p)
    {
        foreach (var pair in new Dictionary<string,object?> { ["$id"]=p.Id.ToString(),["$code"]=p.InternalCode,["$bar"]=p.Barcode,["$name"]=p.Name,["$desc"]=p.Description,["$cat"]=p.Category,["$brand"]=p.Brand,["$cost"]=p.CostPrice,["$price"]=p.SalePrice,["$stock"]=p.Stock,["$min"]=p.MinimumStock,["$unit"]=p.Unit,["$supplier"]=p.Supplier,["$photo"]=p.PhotoPath,["$active"]=p.Active?1:0,["$promo"]=p.PromotionalPrice,["$start"]=p.PromotionStartsAt?.ToString("O"),["$end"]=p.PromotionEndsAt?.ToString("O") }) c.Parameters.AddWithValue(pair.Key, pair.Value ?? DBNull.Value);
    }
    private static Product ReadProduct(SqliteDataReader r) => new(Guid.Parse(r.GetString(r.GetOrdinal("id"))),r.GetString(r.GetOrdinal("internal_code")),Text(r,"barcode"),r.GetString(r.GetOrdinal("name")),Text(r,"description"),Text(r,"category"),Text(r,"brand"),r.GetDecimal(r.GetOrdinal("cost_price")),r.GetDecimal(r.GetOrdinal("sale_price")),r.GetDecimal(r.GetOrdinal("stock")),r.GetDecimal(r.GetOrdinal("minimum_stock")),r.GetString(r.GetOrdinal("unit")),Text(r,"supplier"),Text(r,"photo_path"),r.GetInt32(r.GetOrdinal("active"))==1,r.IsDBNull(r.GetOrdinal("promotional_price"))?null:r.GetDecimal(r.GetOrdinal("promotional_price")),Date(r,"promotion_starts_at"),Date(r,"promotion_ends_at"));
    private static string? Text(SqliteDataReader r,string name){var i=r.GetOrdinal(name);return r.IsDBNull(i)?null:r.GetString(i);}
    private static DateTimeOffset? Date(SqliteDataReader r,string name){var value=Text(r,name);return value is null?null:DateTimeOffset.Parse(value);}
}

public sealed class SqliteSaleRepository(OncaDatabase database, IClock clock) : ISaleRepository
{
    public async Task<Sale> CompleteAsync(Cart cart, IReadOnlyList<Payment> payments, Guid operatorId, Guid sessionId, CancellationToken ct = default)
    {
        await using var c = database.Open(); await using var tx = await c.BeginTransactionAsync(ct);
        try
        {
            var number = await ScalarLong(c, tx, "SELECT COALESCE(MAX(number),0)+1 FROM sales", ct);
            var sale = new Sale(Guid.NewGuid(), number, clock.Now, operatorId, cart.CustomerId, cart.Items.ToArray(), payments, cart.Discount, cart.Total);
            await Exec(c, tx, "INSERT INTO sales(id,number,created_at,operator_id,customer_id,cash_session_id,discount,total) VALUES($id,$n,$at,$op,$customer,$session,$discount,$total)", ct,
                ("$id",sale.Id),("$n",number),("$at",sale.CreatedAt.ToString("O")),("$op",operatorId),("$customer",(object?)cart.CustomerId??DBNull.Value),("$session",sessionId),("$discount",sale.Discount),("$total",sale.Total));
            foreach (var item in cart.Items)
            {
                var changed = await Exec(c, tx, "UPDATE products SET stock=stock-$q WHERE id=$p AND stock >= $q", ct,("$q",item.Quantity),("$p",item.ProductId));
                if (changed != 1) throw new DomainException($"Estoque insuficiente para {item.Name}.");
                await Exec(c, tx,"INSERT INTO sale_items VALUES($id,$sale,$product,$code,$name,$q,$price,$sub)",ct,("$id",Guid.NewGuid()),("$sale",sale.Id),("$product",item.ProductId),("$code",item.Code),("$name",item.Name),("$q",item.Quantity),("$price",item.UnitPrice),("$sub",item.Subtotal));
                await Exec(c, tx,"INSERT INTO stock_movements VALUES($id,$product,'Sale',$q,$sale,'VENDA', $at)",ct,("$id",Guid.NewGuid()),("$product",item.ProductId),("$q",-item.Quantity),("$sale",sale.Id),("$at",sale.CreatedAt.ToString("O")));
            }
            foreach(var p in payments)
            {
                await Exec(c, tx,"INSERT INTO payments VALUES($id,$sale,$method,$amount,$received,$change)",ct,("$id",Guid.NewGuid()),("$sale",sale.Id),("$method",p.Method.ToString()),("$amount",p.Amount),("$received",(object?)p.Received??DBNull.Value),("$change",p.Change));
                if (p.Method != PaymentMethod.StoreCredit) await Exec(c,tx,"INSERT INTO cash_movements VALUES($id,$session,'Sale',$amount,$sale,$reason,$at)",ct,("$id",Guid.NewGuid()),("$session",sessionId),("$amount",p.Amount),("$sale",sale.Id),("$reason",p.Method.ToString()),("$at",sale.CreatedAt.ToString("O")));
                else await Exec(c,tx,"INSERT INTO credit_entries VALUES($id,$customer,$sale,'Debit',$amount,NULL,$at,'VENDA CREDIÁRIO')",ct,("$id",Guid.NewGuid()),("$customer",cart.CustomerId!.Value),("$sale",sale.Id),("$amount",p.Amount),("$at",sale.CreatedAt.ToString("O")));
                if(p.Method==PaymentMethod.StoreCredit)await Exec(c,tx,"INSERT INTO credit_accounts VALUES($id,$customer,$sale,$amount,$amount,$at,$due,'Open',1,NULL)",ct,("$id",Guid.NewGuid()),("$customer",cart.CustomerId!.Value),("$sale",sale.Id),("$amount",p.Amount),("$at",sale.CreatedAt.ToString("O")),("$due",sale.CreatedAt.AddDays(30).ToString("O")));
            }
            await tx.CommitAsync(ct); return sale;
        }
        catch { await tx.RollbackAsync(ct); throw; }
    }
    public async Task<IReadOnlyList<Sale>> LastAsync(int count, CancellationToken ct = default)
    {
        var ids=new List<Guid>(); await using(var c=database.Open()){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT id FROM sales WHERE status='Completed' ORDER BY number DESC LIMIT $n";cmd.Parameters.AddWithValue("$n",count);await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))ids.Add(Guid.Parse(r.GetString(0)));}
        var list=new List<Sale>();foreach(var id in ids){var sale=await GetAsync(id,ct);if(sale is not null)list.Add(sale);}return list;
    }
    public async Task<Sale?> GetAsync(Guid id,CancellationToken ct=default)
    {
        await using var c=database.Open();long number;DateTimeOffset at;Guid op;Guid? customer;decimal discount,total;FiscalStatus fiscal;
        await using(var cmd=c.CreateCommand()){cmd.CommandText="SELECT number,created_at,operator_id,customer_id,discount,total,fiscal_status FROM sales WHERE id=$id";cmd.Parameters.AddWithValue("$id",id.ToString());await using var r=await cmd.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))return null;number=r.GetInt64(0);at=DateTimeOffset.Parse(r.GetString(1));op=Guid.Parse(r.GetString(2));customer=r.IsDBNull(3)?null:Guid.Parse(r.GetString(3));discount=r.GetDecimal(4);total=r.GetDecimal(5);fiscal=Enum.Parse<FiscalStatus>(r.GetString(6));}
        var items=new List<CartItem>();await using(var cmd=c.CreateCommand()){cmd.CommandText="SELECT product_id,code,name,quantity,unit_price FROM sale_items WHERE sale_id=$id ORDER BY rowid";cmd.Parameters.AddWithValue("$id",id.ToString());await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))items.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetString(2),r.GetDecimal(3),r.GetDecimal(4)));}
        var payments=new List<Payment>();await using(var cmd=c.CreateCommand()){cmd.CommandText="SELECT method,amount,received FROM payments WHERE sale_id=$id ORDER BY rowid";cmd.Parameters.AddWithValue("$id",id.ToString());await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))payments.Add(new(Enum.Parse<PaymentMethod>(r.GetString(0)),r.GetDecimal(1),r.IsDBNull(2)?null:r.GetDecimal(2)));}
        return new(id,number,at,op,customer,items,payments,discount,total,fiscal);
    }
    private static async Task<long> ScalarLong(SqliteConnection c, System.Data.Common.DbTransaction tx,string sql,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.Transaction=(SqliteTransaction)tx;cmd.CommandText=sql;return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));}
    private static async Task<int> Exec(SqliteConnection c,System.Data.Common.DbTransaction tx,string sql,CancellationToken ct,params (string,object)[] ps){await using var cmd=c.CreateCommand();cmd.Transaction=(SqliteTransaction)tx;cmd.CommandText=sql;foreach(var p in ps)cmd.Parameters.AddWithValue(p.Item1,p.Item2 is Guid id?id.ToString():p.Item2);return await cmd.ExecuteNonQueryAsync(ct);}
}

public sealed class SqliteCashSessionRepository(OncaDatabase database,IClock clock):ICashSessionRepository
{
    public async Task<CashSession> GetOrOpenAsync(Guid operatorId,decimal openingAmount=0,CancellationToken ct=default)
    {
        await using var c=database.Open();
        await using(var find=c.CreateCommand())
        {
            find.CommandText="SELECT id,opened_at,opening_amount FROM cash_sessions WHERE operator_id=$op AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1";
            find.Parameters.AddWithValue("$op",operatorId.ToString());
            await using var r=await find.ExecuteReaderAsync(ct);
            if(await r.ReadAsync(ct))return new(Guid.Parse(r.GetString(0)),operatorId,DateTimeOffset.Parse(r.GetString(1)),r.GetDecimal(2));
        }

        // Quando o sistema abrir um novo caixa sem um valor manual, reaproveita o
        // último valor REAL informado no fechamento anterior. Isso evita começar
        // cada dia em zero e mantém o saldo acumulado do caixa de forma simples.
        if(openingAmount==0)
        {
            await using var previous=c.CreateCommand();
            previous.CommandText="SELECT informed_total FROM cash_sessions WHERE operator_id=$op AND closed_at IS NOT NULL AND informed_total IS NOT NULL ORDER BY closed_at DESC LIMIT 1";
            previous.Parameters.AddWithValue("$op",operatorId.ToString());
            var previousValue=await previous.ExecuteScalarAsync(ct);
            if(previousValue is not null && previousValue is not DBNull)
                openingAmount=Convert.ToDecimal(previousValue);
        }

        var session=new CashSession(Guid.NewGuid(),operatorId,clock.Now,openingAmount);
        await using var cmd=c.CreateCommand();
        cmd.CommandText="INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES($id,$op,$at,$amount)";
        cmd.Parameters.AddWithValue("$id",session.Id.ToString());
        cmd.Parameters.AddWithValue("$op",operatorId.ToString());
        cmd.Parameters.AddWithValue("$at",session.OpenedAt.ToString("O"));
        cmd.Parameters.AddWithValue("$amount",openingAmount);
        await cmd.ExecuteNonQueryAsync(ct);
        return session;
    }
}

public sealed class JsonCartRecoveryStore(AppPaths paths) : ICartRecoveryStore
{
    private string FilePath => Path.Combine(paths.Data, "pending-cart.json");
    private string BackupPath => Path.Combine(paths.Data, "pending-cart.bak.json");
    private string TempPath => Path.Combine(paths.Data, "pending-cart.tmp.json");

    private sealed record Snapshot(int Version, DateTimeOffset SavedAt, Guid? CustomerId, decimal Discount, List<CartItem> Items);

    public async Task SaveAsync(Cart cart, CancellationToken ct = default)
    {
        paths.EnsureCreated();
        var snapshot = new Snapshot(2, DateTimeOffset.Now, cart.CustomerId, cart.Discount, cart.Items.ToList());
        var json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions { WriteIndented = true });

        await File.WriteAllTextAsync(TempPath, json, ct);
        File.Move(TempPath, FilePath, true);

        // Mantém uma segunda cópia para recuperar a venda mesmo se o arquivo
        // principal for corrompido por uma queda de energia no momento errado.
        File.Copy(FilePath, BackupPath, true);
    }

    public async Task<Cart?> LoadAsync(CancellationToken ct = default)
    {
        var primary = await TryLoadAsync(FilePath, ct);
        if (primary is not null) return primary;

        var backup = await TryLoadAsync(BackupPath, ct);
        if (backup is null) return null;

        // Reconstrói a cópia principal automaticamente a partir do backup válido.
        await SaveAsync(backup, ct);
        return backup;
    }

    private static async Task<Cart?> TryLoadAsync(string file, CancellationToken ct)
    {
        if (!File.Exists(file)) return null;
        try
        {
            var json = await File.ReadAllTextAsync(file, ct);
            var s = JsonSerializer.Deserialize<Snapshot>(json);
            if (s?.Items is null || s.Items.Count == 0) return null;

            var cart = new Cart { CustomerId = s.CustomerId };
            foreach (var i in s.Items)
            {
                var recovered = new Product(
                    i.ProductId, i.Code, null, i.Name, null, null, null,
                    0, i.UnitPrice, 999999, 0, "UN", null, null, true);
                cart.Add(recovered, i.Quantity);
            }

            cart.SetDiscount(Math.Min(s.Discount, cart.GrossTotal));
            return cart;
        }
        catch (JsonException)
        {
            return null;
        }
        catch (IOException)
        {
            return null;
        }
    }

    public Task ClearAsync(CancellationToken ct = default)
    {
        foreach (var file in new[] { FilePath, BackupPath, TempPath })
            if (File.Exists(file)) File.Delete(file);
        return Task.CompletedTask;
    }
}

public sealed class BackupService(OncaDatabase database, AppPaths paths)
{
    public async Task<string> CreateAsync(CancellationToken ct=default)
    {
        paths.EnsureCreated(); var target=Path.Combine(paths.Backups,$"onca-pdv-pro-{DateTime.Now:yyyyMMdd-HHmmss}.db");
        await using var source=database.Open(); await using var destination=new SqliteConnection($"Data Source={target}"); await destination.OpenAsync(ct); source.BackupDatabase(destination);
        await using var check=destination.CreateCommand();check.CommandText="PRAGMA integrity_check";if(!string.Equals(Convert.ToString(await check.ExecuteScalarAsync(ct)),"ok",StringComparison.OrdinalIgnoreCase)){File.Delete(target);throw new InvalidDataException("Backup inválido.");}
        return target;
    }
}
