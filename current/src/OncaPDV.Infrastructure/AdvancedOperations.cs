using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record ProductMetadata(Guid ProductId,string? ShelfLocation);
public sealed record CustomerAccountSummary(Guid CustomerId,decimal CreditLimit,decimal OpenBalance,decimal OverdueBalance,decimal AvailableLimit,int OpenAccounts,int OverdueAccounts);
public sealed record BackupHealth(string? LastBackup,DateTimeOffset? LastBackupAt,bool IsOld,string Message,string? ExternalCopy);

public sealed class AdvancedOperationsService(OncaDatabase db,AppPaths paths)
{
    public void EnsureSchema()
    {
        using var c=db.Open();using var q=c.CreateCommand();
        q.CommandText="""
CREATE TABLE IF NOT EXISTS product_metadata(product_id TEXT PRIMARY KEY,shelf_location TEXT,FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS customer_credit_settings(customer_id TEXT PRIMARY KEY,credit_limit NUMERIC NOT NULL DEFAULT 0,FOREIGN KEY(customer_id) REFERENCES customers(id));
CREATE TABLE IF NOT EXISTS sale_corrections(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,operator_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(sale_id) REFERENCES sales(id));
CREATE INDEX IF NOT EXISTS ix_sale_corrections_sale ON sale_corrections(sale_id,created_at);
INSERT OR IGNORE INTO schema_versions VALUES(5,datetime('now'));
""";
        q.ExecuteNonQuery();
    }

    public async Task<ProductMetadata> ProductMetadataAsync(Guid productId,CancellationToken ct=default)
    {
        EnsureSchema();await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText="SELECT shelf_location FROM product_metadata WHERE product_id=$id";q.Parameters.AddWithValue("$id",productId.ToString());
        var value=await q.ExecuteScalarAsync(ct);return new(productId,value is null||value is DBNull?null:Convert.ToString(value));
    }

    public async Task SaveProductMetadataAsync(Guid productId,string? shelf,CancellationToken ct=default)
    {
        EnsureSchema();await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText="INSERT INTO product_metadata(product_id,shelf_location) VALUES($id,$shelf) ON CONFLICT(product_id) DO UPDATE SET shelf_location=excluded.shelf_location";
        q.Parameters.AddWithValue("$id",productId.ToString());q.Parameters.AddWithValue("$shelf",string.IsNullOrWhiteSpace(shelf)?DBNull.Value:shelf.Trim());await q.ExecuteNonQueryAsync(ct);
    }

    public async Task<CustomerAccountSummary> CustomerAccountAsync(Guid customerId,CancellationToken ct=default)
    {
        EnsureSchema();await using var c=db.Open();
        async Task<decimal> D(string sql){await using var q=c.CreateCommand();q.CommandText=sql;q.Parameters.AddWithValue("$id",customerId.ToString());return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));}
        async Task<int> I(string sql){await using var q=c.CreateCommand();q.CommandText=sql;q.Parameters.AddWithValue("$id",customerId.ToString());return Convert.ToInt32(await q.ExecuteScalarAsync(ct));}
        var limit=await D("SELECT COALESCE((SELECT credit_limit FROM customer_credit_settings WHERE customer_id=$id),0)");
        var open=await D("SELECT COALESCE(SUM(balance),0) FROM credit_accounts WHERE customer_id=$id AND balance>0");
        var overdue=await D("SELECT COALESCE(SUM(balance),0) FROM credit_accounts WHERE customer_id=$id AND balance>0 AND due_at<datetime('now')");
        var count=await I("SELECT COUNT(*) FROM credit_accounts WHERE customer_id=$id AND balance>0");
        var overdueCount=await I("SELECT COUNT(*) FROM credit_accounts WHERE customer_id=$id AND balance>0 AND due_at<datetime('now')");
        return new(customerId,limit,open,overdue,Math.Max(0,limit-open),count,overdueCount);
    }

    public async Task SetCustomerCreditLimitAsync(Guid customerId,decimal limit,Guid operatorId,string reason,CancellationToken ct=default)
    {
        if(limit<0)throw new DomainException("Limite de crédito inválido.");EnsureSchema();await using var c=db.Open();await using var tx=await c.BeginTransactionAsync(ct);
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="INSERT INTO customer_credit_settings(customer_id,credit_limit) VALUES($id,$limit) ON CONFLICT(customer_id) DO UPDATE SET credit_limit=excluded.credit_limit";q.Parameters.AddWithValue("$id",customerId.ToString());q.Parameters.AddWithValue("$limit",limit);await q.ExecuteNonQueryAsync(ct);}
        await AuditAsync(c,(SqliteTransaction)tx,operatorId,"CREDIT_LIMIT_CHANGE","Customer",customerId,reason,new{CreditLimit=limit},ct);await tx.CommitAsync(ct);
    }

    public async Task CancelSaleAsync(Guid saleId,Guid operatorId,string reason,CancellationToken ct=default)
    {
        if(string.IsNullOrWhiteSpace(reason))throw new DomainException("Informe o motivo do cancelamento.");EnsureSchema();await using var c=db.Open();await using var tx=await c.BeginTransactionAsync(ct);
        string status;Guid session;Guid? customer;
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT status,cash_session_id,customer_id FROM sales WHERE id=$id";q.Parameters.AddWithValue("$id",saleId.ToString());await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new DomainException("Venda não encontrada.");status=r.GetString(0);session=Guid.Parse(r.GetString(1));customer=r.IsDBNull(2)?null:Guid.Parse(r.GetString(2));}
        if(status=="Cancelled")throw new DomainException("Esta venda já está cancelada.");
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT COUNT(*) FROM credit_receipts cr JOIN credit_accounts ca ON ca.id=cr.account_id WHERE ca.sale_id=$sale";q.Parameters.AddWithValue("$sale",saleId.ToString());if(Convert.ToInt32(await q.ExecuteScalarAsync(ct))>0)throw new DomainException("Venda possui recebimento de crediário. Estorne o recebimento antes de cancelar.");}

        var items=new List<(Guid Product,decimal Quantity)>();
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT product_id,quantity FROM sale_items WHERE sale_id=$sale";q.Parameters.AddWithValue("$sale",saleId.ToString());await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))items.Add((Guid.Parse(r.GetString(0)),r.GetDecimal(1)));}
        foreach(var item in items)
        {
            await using(var u=c.CreateCommand()){u.Transaction=(SqliteTransaction)tx;u.CommandText="UPDATE products SET stock=stock+$q WHERE id=$id";u.Parameters.AddWithValue("$q",item.Quantity);u.Parameters.AddWithValue("$id",item.Product.ToString());await u.ExecuteNonQueryAsync(ct);}
            await using(var m=c.CreateCommand()){m.Transaction=(SqliteTransaction)tx;m.CommandText="INSERT INTO stock_movements(id,product_id,type,quantity,origin_id,reason,created_at) VALUES($id,$product,'Cancellation',$q,$sale,$reason,$at)";m.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());m.Parameters.AddWithValue("$product",item.Product.ToString());m.Parameters.AddWithValue("$q",item.Quantity);m.Parameters.AddWithValue("$sale",saleId.ToString());m.Parameters.AddWithValue("$reason",reason.Trim());m.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await m.ExecuteNonQueryAsync(ct);}
        }

        var payments=new List<(string Method,decimal Amount)>();
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT method,amount FROM payments WHERE sale_id=$sale";q.Parameters.AddWithValue("$sale",saleId.ToString());await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))payments.Add((r.GetString(0),r.GetDecimal(1)));}
        foreach(var p in payments.Where(x=>x.Method!="StoreCredit"))
        {
            await using var m=c.CreateCommand();m.Transaction=(SqliteTransaction)tx;m.CommandText="INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at) VALUES($id,$session,'Sale',$amount,$sale,$method,$at)";m.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());m.Parameters.AddWithValue("$session",session.ToString());m.Parameters.AddWithValue("$amount",-p.Amount);m.Parameters.AddWithValue("$sale",saleId.ToString());m.Parameters.AddWithValue("$method",p.Method);m.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await m.ExecuteNonQueryAsync(ct);
        }
        if(payments.Any(x=>x.Method=="StoreCredit"))
        {
            await using(var d=c.CreateCommand()){d.Transaction=(SqliteTransaction)tx;d.CommandText="DELETE FROM credit_accounts WHERE sale_id=$sale";d.Parameters.AddWithValue("$sale",saleId.ToString());await d.ExecuteNonQueryAsync(ct);}
            if(customer is Guid customerId){await using var e=c.CreateCommand();e.Transaction=(SqliteTransaction)tx;e.CommandText="INSERT INTO credit_entries(id,customer_id,sale_id,type,amount,due_at,created_at,reason) VALUES($id,$customer,$sale,'Credit',$amount,NULL,$at,$reason)";e.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());e.Parameters.AddWithValue("$customer",customerId.ToString());e.Parameters.AddWithValue("$sale",saleId.ToString());e.Parameters.AddWithValue("$amount",-payments.Where(x=>x.Method=="StoreCredit").Sum(x=>x.Amount));e.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));e.Parameters.AddWithValue("$reason","CANCELAMENTO: "+reason.Trim());await e.ExecuteNonQueryAsync(ct);}
        }
        await using(var s=c.CreateCommand()){s.Transaction=(SqliteTransaction)tx;s.CommandText="UPDATE sales SET status='Cancelled' WHERE id=$id";s.Parameters.AddWithValue("$id",saleId.ToString());await s.ExecuteNonQueryAsync(ct);}
        await using(var log=c.CreateCommand()){log.Transaction=(SqliteTransaction)tx;log.CommandText="INSERT INTO sale_corrections(id,sale_id,operator_id,action,reason,created_at) VALUES($id,$sale,$op,'CANCEL',$reason,$at)";log.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());log.Parameters.AddWithValue("$sale",saleId.ToString());log.Parameters.AddWithValue("$op",operatorId.ToString());log.Parameters.AddWithValue("$reason",reason.Trim());log.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await log.ExecuteNonQueryAsync(ct);}
        await AuditAsync(c,(SqliteTransaction)tx,operatorId,"SALE_CANCEL","Sale",saleId,reason,new{Status="Cancelled"},ct);await tx.CommitAsync(ct);
    }

    public async Task PrepareCorrectionAsync(Guid saleId,Guid operatorId,string reason,CancellationToken ct=default)
    {
        var sale=await new SqliteSaleRepository(db,new SystemClock()).GetAsync(saleId,ct)??throw new DomainException("Venda não encontrada.");
        await CancelSaleAsync(saleId,operatorId,"CORREÇÃO: "+reason,ct);
        var cart=new Cart{CustomerId=sale.CustomerId};
        foreach(var item in sale.Items)
        {
            var p=new Product(item.ProductId,item.Code,null,item.Name,null,null,null,item.UnitPrice,item.UnitPrice,999999,0,"UN",null,null,true);
            cart.Add(p,item.Quantity);
        }
        cart.SetDiscount(Math.Min(sale.Discount,cart.GrossTotal));await new JsonCartRecoveryStore(paths).SaveAsync(cart,ct);
        await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="INSERT INTO sale_corrections(id,sale_id,operator_id,action,reason,created_at) VALUES($id,$sale,$op,'CORRECTION_PREPARED',$reason,$at)";q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());q.Parameters.AddWithValue("$sale",saleId.ToString());q.Parameters.AddWithValue("$op",operatorId.ToString());q.Parameters.AddWithValue("$reason",reason.Trim());q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await q.ExecuteNonQueryAsync(ct);
    }

    public async Task<BackupHealth> EnsureProtectedBackupAsync(CancellationToken ct=default)
    {
        var prefs=await new BackupPreferencesStore(paths).LoadAsync(ct);if(!prefs.Enabled)return new(null,null,false,"Backup automático desativado.",null);
        var ops=new OperationalService(db,paths);var file=await ops.EnsureDailyBackupAsync(ct);string? external=null;
        if(file is not null&&!string.IsNullOrWhiteSpace(prefs.ExternalFolder))
        {
            try{Directory.CreateDirectory(prefs.ExternalFolder!);external=Path.Combine(prefs.ExternalFolder!,Path.GetFileName(file));File.Copy(file,external,true);}
            catch(Exception ex){external="FALHA: "+ex.Message;}
        }
        var latest=Directory.GetFiles(paths.Backups,"*.zip").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();var at=latest is null?(DateTimeOffset?)null:new DateTimeOffset(File.GetLastWriteTimeUtc(latest),TimeSpan.Zero).ToLocalTime();var old=at is null||DateTimeOffset.Now-at.Value>TimeSpan.FromHours(Math.Max(1,prefs.WarnAfterHours));
        return new(latest,at,old,old?"ATENÇÃO: backup antigo ou inexistente.":"Backup automático atualizado.",external);
    }

    private static async Task AuditAsync(SqliteConnection c,SqliteTransaction tx,Guid user,string action,string entity,Guid entityId,string reason,object after,CancellationToken ct)
    {
        await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="INSERT INTO audit_log(id,user_id,action,entity,entity_id,before_json,after_json,reason,created_at) VALUES($id,$user,$action,$entity,$entityId,NULL,$after,$reason,$at)";q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());q.Parameters.AddWithValue("$user",user.ToString());q.Parameters.AddWithValue("$action",action);q.Parameters.AddWithValue("$entity",entity);q.Parameters.AddWithValue("$entityId",entityId.ToString());q.Parameters.AddWithValue("$after",JsonSerializer.Serialize(after));q.Parameters.AddWithValue("$reason",reason.Trim());q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await q.ExecuteNonQueryAsync(ct);
    }
}
