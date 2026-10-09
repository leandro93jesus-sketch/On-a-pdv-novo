using System.Globalization;
using System.Text;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record CashPulse0230(int Sales, decimal Cash, decimal Pix, decimal Debit, decimal Credit, decimal StoreCredit, decimal CreditReceipts)
{
    public decimal Net => Cash + Pix + Debit + Credit + StoreCredit;
}

public sealed record CustomerPulse0230(string Name, int Purchases, decimal Spent, decimal CreditBalance, int OpenCredits, decimal CreditPaid, DateTimeOffset? LastPurchase);
public sealed record ProductCodeConflict0230(Guid Id, string Name, string Field, string Value);

public static class ScannerCommand0230
{
    public static bool TryParse(string input, out string query, out decimal quantity)
    {
        query = (input ?? string.Empty).Trim();
        quantity = 1m;
        if (query.Length == 0) return false;
        var star = query.IndexOf('*');
        var lowerX=query.IndexOf('x'); var upperX=query.IndexOf('X');
        var x=lowerX>=0?lowerX:upperX;
        var split = star >= 0 ? star : x;
        if (split <= 0 || split >= query.Length - 1) return true;
        var left = query[..split].Trim();
        var right = query[(split + 1)..].Trim();
        if (!decimal.TryParse(left, NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out var q) || q <= 0 || right.Length == 0)
            return true;
        quantity = q;
        query = right;
        return true;
    }
}

public sealed class CheckoutActionGuard0230
{
    private int _busy;
    public bool TryEnter() => System.Threading.Interlocked.CompareExchange(ref _busy, 1, 0) == 0;
    public void Exit() => System.Threading.Volatile.Write(ref _busy, 0);
    public bool IsBusy => System.Threading.Volatile.Read(ref _busy) != 0;
}

public static class StockAlert0230
{
    public static string? Evaluate(Product product, decimal quantityInCart)
    {
        if (product.Id == Guid.Parse("00000000-0000-0000-0000-000000000001")) return null;
        var remaining = product.Stock - quantityInCart;
        if (remaining <= 0) return $"SEM ESTOQUE • {product.Name} • venda permitida";
        if (product.MinimumStock > 0 && remaining <= product.MinimumStock)
            return $"ESTOQUE BAIXO • {product.Name} • restante estimado {remaining:N3} {product.Unit}";
        return null;
    }
}

public sealed class ProductCodeGuard0230(OncaDatabase db)
{
    public async Task<ProductCodeConflict0230?> FindConflictAsync(string internalCode, string? barcode, Guid? excludeId = null, CancellationToken ct = default)
    {
        internalCode = (internalCode ?? string.Empty).Trim();
        barcode = string.IsNullOrWhiteSpace(barcode) ? null : barcode.Trim();
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = @"SELECT id,name,internal_code,barcode FROM products
WHERE ($exclude IS NULL OR id<>$exclude)
  AND ((TRIM($code)<>'' AND internal_code=$code COLLATE NOCASE)
       OR ($bar IS NOT NULL AND barcode=$bar COLLATE NOCASE))
ORDER BY CASE WHEN internal_code=$code COLLATE NOCASE THEN 0 ELSE 1 END LIMIT 1";
        q.Parameters.AddWithValue("$exclude", (object?)excludeId?.ToString() ?? DBNull.Value);
        q.Parameters.AddWithValue("$code", internalCode);
        q.Parameters.AddWithValue("$bar", (object?)barcode ?? DBNull.Value);
        await using var r = await q.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        var field = string.Equals(r.GetString(2), internalCode, StringComparison.OrdinalIgnoreCase) ? "Código interno" : "Código de barras";
        var value = field == "Código interno" ? r.GetString(2) : (r.IsDBNull(3) ? string.Empty : r.GetString(3));
        return new(Guid.Parse(r.GetString(0)), r.GetString(1), field, value);
    }
}

public sealed class CheckoutInsights0230(OncaDatabase db, AppPaths paths)
{
    public async Task<CashPulse0230> TodayAsync(CancellationToken ct = default)
    {
        var now=DateTimeOffset.Now;
        var from=new DateTimeOffset(now.Year,now.Month,now.Day,0,0,0,now.Offset);
        var to=from.AddDays(1);
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = @"SELECT
(SELECT COUNT(*) FROM sales s WHERE s.status='Completed' AND s.created_at >= $from AND s.created_at < $to),
COALESCE(SUM(CASE WHEN p.method='Cash' THEN p.amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN p.method='Pix' THEN p.amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN p.method='Debit' THEN p.amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN p.method='Credit' THEN p.amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN p.method='StoreCredit' THEN p.amount ELSE 0 END),0)
FROM payments p JOIN sales s ON s.id=p.sale_id
WHERE s.status='Completed' AND s.created_at >= $from AND s.created_at < $to";
        q.Parameters.AddWithValue("$from", from.ToString("O"));
        q.Parameters.AddWithValue("$to", to.ToString("O"));
        await using var r = await q.ExecuteReaderAsync(ct);
        await r.ReadAsync(ct);
        var receipts = await ScalarAsync(c, @"SELECT COALESCE(SUM(r.amount),0)-COALESCE((SELECT SUM(x.amount) FROM credit_receipt_reversals x WHERE x.created_at >= $from AND x.created_at < $to),0)
FROM credit_receipts r WHERE r.created_at >= $from AND r.created_at < $to", from, to, ct);
        return new(r.GetInt32(0), r.GetDecimal(1), r.GetDecimal(2), r.GetDecimal(3), r.GetDecimal(4), r.GetDecimal(5), receipts);
    }

    public async Task<CustomerPulse0230?> CustomerAsync(Guid customerId, CancellationToken ct = default)
    {
        await using var c = db.Open();
        string? name;
        await using (var q = c.CreateCommand())
        {
            q.CommandText = "SELECT name FROM customers WHERE id=$id";
            q.Parameters.AddWithValue("$id", customerId.ToString());
            name = Convert.ToString(await q.ExecuteScalarAsync(ct));
        }
        if (string.IsNullOrWhiteSpace(name)) return null;
        int purchases; decimal spent; DateTimeOffset? last = null;
        await using (var q = c.CreateCommand())
        {
            q.CommandText = "SELECT COUNT(*),COALESCE(SUM(total),0),MAX(created_at) FROM sales WHERE customer_id=$id AND status='Completed'";
            q.Parameters.AddWithValue("$id", customerId.ToString());
            await using var r = await q.ExecuteReaderAsync(ct); await r.ReadAsync(ct);
            purchases = r.GetInt32(0); spent = r.GetDecimal(1);
            if (!r.IsDBNull(2)) last = DateTimeOffset.Parse(r.GetString(2));
        }
        decimal balance; int open;
        await using (var q = c.CreateCommand())
        {
            q.CommandText = @"SELECT COALESCE(SUM(a.balance),0),COUNT(*) FROM credit_accounts a
JOIN sales s ON s.id=a.sale_id
WHERE a.customer_id=$id AND a.balance>0 AND a.status NOT IN ('Paid','Cancelled') AND s.status='Completed'
AND NOT EXISTS(SELECT 1 FROM credit_account_deletions_046 d WHERE d.account_id=a.id)";
            q.Parameters.AddWithValue("$id", customerId.ToString());
            await using var r = await q.ExecuteReaderAsync(ct); await r.ReadAsync(ct);
            balance = r.GetDecimal(0); open = r.GetInt32(1);
        }
        var paid = await ScalarCustomerAsync(c, "SELECT COALESCE(SUM(r.amount),0) FROM credit_receipts r JOIN credit_accounts a ON a.id=r.account_id LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id WHERE a.customer_id=$id AND x.id IS NULL", customerId, ct);
        return new(name, purchases, spent, balance, open, paid, last);
    }

    public string HealthText()
    {
        var dbOk = string.Equals(db.IntegrityCheck(), "ok", StringComparison.OrdinalIgnoreCase);
        try
        {
            paths.EnsureCreated();
            var last = Directory.GetFiles(paths.Backups, "*.zip").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
            if (!dbOk) return "ATENÇÃO • banco requer conferência";
            if (last is null) return "ATENÇÃO • sem backup";
            var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(last);
            return age <= TimeSpan.FromHours(36) ? "SISTEMA OK" : $"ATENÇÃO • backup há {(int)age.TotalHours}h";
        }
        catch { return dbOk ? "ATENÇÃO • backup indisponível" : "ATENÇÃO • banco"; }
    }

    private static async Task<decimal> ScalarAsync(SqliteConnection c, string sql, DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        await using var q = c.CreateCommand(); q.CommandText = sql; q.Parameters.AddWithValue("$from", from.ToString("O")); q.Parameters.AddWithValue("$to", to.ToString("O"));
        return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
    }
    private static async Task<decimal> ScalarCustomerAsync(SqliteConnection c, string sql, Guid id, CancellationToken ct)
    {
        await using var q = c.CreateCommand(); q.CommandText = sql; q.Parameters.AddWithValue("$id", id.ToString());
        return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
    }
}
