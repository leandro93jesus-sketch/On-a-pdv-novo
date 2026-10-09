namespace OncaPDV.Infrastructure;

public sealed record DailyCashMovements030(decimal Withdrawals,decimal Supplies);
public sealed class CashMovements030(OncaDatabase db)
{
    public async Task<DailyCashMovements030> TodayAsync(CancellationToken ct=default)
    {
        var now=DateTimeOffset.Now;
        var from=new DateTimeOffset(now.Year,now.Month,now.Day,0,0,0,now.Offset);
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText="SELECT COALESCE(SUM(CASE WHEN type='Withdrawal' THEN amount ELSE 0 END),0),COALESCE(SUM(CASE WHEN type='Supply' THEN amount ELSE 0 END),0) FROM cash_movements WHERE created_at >= $from AND created_at < $to";
        q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",from.AddDays(1).ToString("O"));
        await using var r=await q.ExecuteReaderAsync(ct);await r.ReadAsync(ct);
        return new(r.GetDecimal(0),r.GetDecimal(1));
    }
}
