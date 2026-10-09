using System.Windows;
using Microsoft.Data.Sqlite;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public sealed record CreditAuditRow049(string Customer,long SaleNumber,decimal Original,decimal Paid,
    decimal Forgiven,DateTimeOffset RemovedAt,string Reason,string FinancialAlert)
{
    public string RemovedAtDisplay => RemovedAt.ToLocalTime().ToString("dd/MM/yyyy HH:mm");
}

public partial class CreditAudit049Window:Window
{
    private readonly OncaDatabase _db;
    private readonly Guid? _customer;
    public CreditAudit049Window(OncaDatabase db,Guid? customer)
    {
        _db=db;_customer=customer;InitializeComponent();
        Loaded+=async(_,_)=>await LoadAudit();
    }
    private async Task LoadAudit()
    {
        var rows=new List<CreditAuditRow049>();
        await using var c=_db.Open();await using var q=c.CreateCommand();
        q.CommandText=@"SELECT c.name,s.number,a.original_amount,d.net_paid,d.removed_balance,d.created_at,d.reason,
COALESCE(x.details,'')
FROM credit_account_deletions_046 d LEFT JOIN credit_archive_exceptions_050 x ON x.account_id=d.account_id
JOIN credit_accounts a ON a.id=d.account_id
JOIN customers c ON c.id=a.customer_id JOIN sales s ON s.id=a.sale_id
WHERE ($customer IS NULL OR a.customer_id=$customer)
ORDER BY d.created_at DESC LIMIT 10000";
        q.Parameters.AddWithValue("$customer",(object?)_customer?.ToString()??DBNull.Value);
        await using var reader=await q.ExecuteReaderAsync();
        while(await reader.ReadAsync())rows.Add(new(reader.GetString(0),reader.GetInt64(1),
            reader.GetDecimal(2),reader.GetDecimal(3),reader.GetDecimal(4),
            DateTimeOffset.Parse(reader.GetString(5)),reader.GetString(6),reader.GetString(7)));
        AuditGrid.ItemsSource=rows;
        Summary.Text=$"{rows.Count} conta(s) arquivadas; {rows.Count(x=>x.FinancialAlert.Length>0)} com alertas de dados anteriores — conferir sem alterar caixa.";
    }
    private void Close_Click(object sender,RoutedEventArgs e)=>Close();
}
