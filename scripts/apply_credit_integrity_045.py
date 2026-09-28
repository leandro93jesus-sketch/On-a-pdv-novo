from pathlib import Path
import re

root=Path("work-final/ONCA-PDV-PRO").resolve()
i=root/"src"/"OncaPDV.Infrastructure"
d=root/"src"/"OncaPDV.Desktop"
t=root/"tests"/"OncaPDV.Tests"

def once(s,a,b,why):
    n=s.count(a)
    if n!=1:raise RuntimeError(f"{why}: expected 1 occurrence, got {n}")
    return s.replace(a,b,1)

p=i/"Database.cs";s=p.read_text(encoding="utf-8-sig")
needle='''        MigrateV5(c);
        using(var q=c.CreateCommand()){'''
replacement='''        MigrateV5(c);
        using(var creditMigration=c.CreateCommand()){
            creditMigration.CommandText=@"CREATE TABLE IF NOT EXISTS credit_receipt_requests_045(
request_id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,
amount NUMERIC NOT NULL,method TEXT NOT NULL,session_id TEXT NOT NULL,created_at TEXT NOT NULL,
FOREIGN KEY(receipt_id) REFERENCES credit_receipts(id));
CREATE TABLE IF NOT EXISTS credit_receipt_cash_links_045(
receipt_id TEXT PRIMARY KEY,cash_movement_id TEXT NOT NULL UNIQUE,
FOREIGN KEY(receipt_id) REFERENCES credit_receipts(id),
FOREIGN KEY(cash_movement_id) REFERENCES cash_movements(id));";
            creditMigration.ExecuteNonQuery();
        }
        using(var q=c.CreateCommand()){'''
s=once(s,needle,replacement,"add only credit migration")
# Multiple credit components in one payment must create a SINGLE account for that sale,
# while preserving separate payment rows for the tender audit.
old='''                 else await Exec(c,tx,"INSERT INTO credit_entries VALUES($id,$customer,$sale,'Debit',$amount,NULL,$at,'VENDA CREDIÁRIO')",ct,("$id",Guid.NewGuid()),("$customer",cart.CustomerId!.Value),("$sale",sale.Id),("$amount",p.Amount),("$at",sale.CreatedAt.ToString("O")));
                 if(p.Method==PaymentMethod.StoreCredit)await Exec(c,tx,"INSERT INTO credit_accounts VALUES($id,$customer,$sale,$amount,$amount,$at,$due,'Open',1,NULL)",ct,("$id",Guid.NewGuid()),("$customer",cart.CustomerId!.Value),("$sale",sale.Id),("$amount",p.Amount),("$at",sale.CreatedAt.ToString("O")),("$due",sale.CreatedAt.AddDays(30).ToString("O")));
            }
            await Exec(c,tx,"INSERT INTO checkout_keys_044'''
new='''            }
            var creditTotal=payments.Where(x=>x.Method==PaymentMethod.StoreCredit).Sum(x=>x.Amount);
            if(creditTotal>0)
            {
                await Exec(c,tx,"INSERT INTO credit_entries VALUES($id,$customer,$sale,'Debit',$amount,NULL,$at,'VENDA CREDIÁRIO')",ct,
                    ("$id",Guid.NewGuid()),("$customer",cart.CustomerId!.Value),("$sale",sale.Id),("$amount",creditTotal),("$at",sale.CreatedAt.ToString("O")));
                await Exec(c,tx,"INSERT INTO credit_accounts VALUES($id,$customer,$sale,$amount,$amount,$at,$due,'Open',1,NULL)",ct,
                    ("$id",Guid.NewGuid()),("$customer",cart.CustomerId!.Value),("$sale",sale.Id),("$amount",creditTotal),("$at",sale.CreatedAt.ToString("O")),("$due",sale.CreatedAt.AddDays(30).ToString("O")));
            }
            await Exec(c,tx,"INSERT INTO checkout_keys_044'''
s=once(s,old,new,"single consolidated credit account")
p.write_text(s,encoding="utf-8")

p=i/"CustomerCredit.cs";s=p.read_text(encoding="utf-8-sig")
m=re.search(r"  public async Task<CreditReceipt> ReceiveAsync\(.*?\n  private static async Task Exec",s,re.S)
if not m:raise RuntimeError("credit ReceiveAsync anchor absent")
replacement=r'''  // API compatibility: ordinary legitimate payments obtain a fresh request ID.
  public Task<CreditReceipt> ReceiveAsync(Guid accountId,decimal amount,PaymentMethod method,Guid operatorId,
      Guid sessionId,string? notes,CancellationToken ct=default)
      =>ReceiveOnceAsync(accountId,amount,method,operatorId,sessionId,notes,Guid.NewGuid(),ct);

  // Replaying the SAME request key returns the original receipt, even after the
  // client loses the response. A fresh payment must use a different request key.
  public async Task<CreditReceipt> ReceiveOnceAsync(Guid accountId,decimal amount,PaymentMethod method,Guid operatorId,
      Guid sessionId,string? notes,Guid requestId,CancellationToken ct=default)
  {
      if(requestId==Guid.Empty)throw new DomainException("Identificador de recebimento inválido.");
      if(amount<=0)throw new DomainException("Valor inválido.");
      if(method==PaymentMethod.StoreCredit)throw new DomainException("Recebimento de crediário não pode ser pago com outro crediário.");
      await using var c=db.Open();
      await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);
      await using(var lookup=c.CreateCommand())
      {
          lookup.Transaction=tx;
          lookup.CommandText=@"SELECT r.id,r.account_id,r.amount,r.method,r.operator_id,r.created_at,r.notes,k.session_id
FROM credit_receipt_requests_045 k JOIN credit_receipts r ON r.id=k.receipt_id WHERE k.request_id=$request";
          lookup.Parameters.AddWithValue("$request",requestId.ToString());
          await using var r=await lookup.ExecuteReaderAsync(ct);
          if(await r.ReadAsync(ct))
          {
              if(r.GetString(1)!=accountId.ToString() || r.GetDecimal(2)!=amount ||
                  r.GetString(3)!=method.ToString() || r.GetString(7)!=sessionId.ToString())
                  throw new DomainException("Esta operação já foi utilizada com dados diferentes.");
              var prior=new CreditReceipt(Guid.Parse(r.GetString(0)),accountId,r.GetDecimal(2),
                  Enum.Parse<PaymentMethod>(r.GetString(3)),Guid.Parse(r.GetString(4)),
                  DateTimeOffset.Parse(r.GetString(5)),r.IsDBNull(6)?null:r.GetString(6));
              await tx.CommitAsync(ct);
              return prior;
          }
      }
      decimal balance;
      await using(var get=c.CreateCommand())
      {
          get.Transaction=tx;
          get.CommandText=@"SELECT a.balance FROM credit_accounts a
JOIN sales s ON s.id=a.sale_id
WHERE a.id=$id AND a.status NOT IN ('Paid','Cancelled') AND s.status='Completed'";
          get.Parameters.AddWithValue("$id",accountId.ToString());
          var v=await get.ExecuteScalarAsync(ct);
          if(v is null || v is DBNull)throw new DomainException("Conta não encontrada, venda excluída ou crediário encerrado.");
          balance=Convert.ToDecimal(v);
      }
      if(amount>balance)throw new DomainException("Recebimento maior que o saldo.");
      var receipt=new CreditReceipt(Guid.NewGuid(),accountId,amount,method,operatorId,clock.Now,notes);
      await Exec(c,tx,"INSERT INTO credit_receipts VALUES($id,$account,$amount,$method,$op,$at,$notes)",
          ("$id",receipt.Id),("$account",accountId),("$amount",amount),("$method",method.ToString()),
          ("$op",operatorId),("$at",receipt.CreatedAt.ToString("O")),("$notes",(object?)notes??DBNull.Value));
      await using(var update=c.CreateCommand())
      {
          update.Transaction=tx;
          update.CommandText=@"UPDATE credit_accounts
SET balance=balance-$amount,status=CASE WHEN balance-$amount=0 THEN 'Paid' ELSE 'Partial' END
WHERE id=$id AND status NOT IN ('Paid','Cancelled') AND balance >= $amount";
          update.Parameters.AddWithValue("$amount",amount);
          update.Parameters.AddWithValue("$id",accountId.ToString());
          if(await update.ExecuteNonQueryAsync(ct)!=1)
              throw new DomainException("O saldo mudou durante o recebimento. Atualize o crediário e confira novamente.");
      }
      var movementId=Guid.NewGuid();
      await Exec(c,tx,"INSERT INTO cash_movements VALUES($id,$session,'StoreCreditReceipt',$amount,$account,'RECEBIMENTO CREDIÁRIO',$at)",
          ("$id",movementId),("$session",sessionId),("$amount",amount),("$account",accountId),
          ("$at",receipt.CreatedAt.ToString("O")));
      await Exec(c,tx,"INSERT INTO credit_receipt_cash_links_045(receipt_id,cash_movement_id) VALUES($receipt,$movement)",
          ("$receipt",receipt.Id),("$movement",movementId));
      await Exec(c,tx,@"INSERT INTO credit_receipt_requests_045(request_id,receipt_id,account_id,amount,method,session_id,created_at)
VALUES($request,$receipt,$account,$amount,$method,$session,$at)",
          ("$request",requestId),("$receipt",receipt.Id),("$account",accountId),("$amount",amount),
          ("$method",method.ToString()),("$session",sessionId),("$at",receipt.CreatedAt.ToString("O")));
      await tx.CommitAsync(ct);
      return receipt;
  }

  private static async Task Exec'''
s=s[:m.start()]+replacement+s[m.end():]
p.write_text(s,encoding="utf-8")

# Exact receipt-to-cash matching: do not put a reversal into whichever
# session happened to be last for the customer account.
p=i/"AdvancedOperations.cs";s=p.read_text(encoding="utf-8-sig")
old='''var session=await ScalarText(c,tx,"SELECT session_id FROM cash_movements WHERE origin_id=$a AND type='StoreCreditReceipt' ORDER BY created_at DESC LIMIT 1",("$a",account),ct);'''
s=once(s,old,'var session=await ReceiptCashSession045(c,tx,receipt.Id,ct);',"sale reversal cash session")
s=once(s,old,'var session=await ReceiptCashSession045(c,tx,receiptId,ct);',"receipt reversal cash session")
helper=r'''
    private static async Task<string> ReceiptCashSession045(SqliteConnection c,SqliteTransaction tx,Guid receiptId,CancellationToken ct)
    {
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"SELECT m.session_id FROM credit_receipt_cash_links_045 l
JOIN cash_movements m ON m.id=l.cash_movement_id WHERE l.receipt_id=$receipt";
            q.Parameters.AddWithValue("$receipt",receiptId.ToString());
            var direct=await q.ExecuteScalarAsync(ct);
            if(direct is not null && direct is not DBNull)return Convert.ToString(direct)!;
        }
        // Legacy pre-0.1.45 receipts did not store an explicit cash-link.
        // Match the identical account, exact amount and original creation timestamp.
        // Ambiguous historical records must be checked manually rather than reversed in a wrong session.
        var matches=new List<string>();
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"SELECT m.session_id FROM credit_receipts r
JOIN cash_movements m ON m.origin_id=r.account_id AND m.type='StoreCreditReceipt'
AND m.amount=r.amount AND m.created_at=r.created_at WHERE r.id=$receipt AND m.amount>0 LIMIT 2";
            q.Parameters.AddWithValue("$receipt",receiptId.ToString());
            await using var reader=await q.ExecuteReaderAsync(ct);
            while(await reader.ReadAsync(ct))matches.Add(reader.GetString(0));
        }
        if(matches.Count!=1)throw new DomainException("Não foi possível identificar com segurança o caixa do recebimento antigo. Faça backup e revise o histórico antes de estornar.");
        return matches[0];
    }

'''
anchor='    private async Task AddEvent('
s=once(s,anchor,helper+anchor,"cash matching helper")
# Protect against changing payment type when a pre-existing account remains active.
# Existing active receipt reversals keep their audit. No deletion.
p.write_text(s,encoding="utf-8")

# Summary reports: keep audit entries but do not sum reversed receipts as active revenue.
p=i/"OperationalServices.cs";s=p.read_text(encoding="utf-8-sig")
s=once(s,"($status='Todos' OR a.status=$status", "($status='Todos' AND a.status<>'Cancelled' OR a.status=$status","default credit filter")
s=once(s,"if(st is not CreditStatus.Paid&&due<DateTimeOffset.Now)st=CreditStatus.Overdue;",
       "if(st is not CreditStatus.Paid and not CreditStatus.Cancelled&&due<DateTimeOffset.Now)st=CreditStatus.Overdue;",
       "do not label cancelled accounts overdue")
s=once(s,
    'var receipts=await Scalar(c,"SELECT COALESCE(SUM(amount),0) FROM credit_receipts WHERE created_at >= $from AND created_at < $to",from,to,ct);',
    '''var receipts=await Scalar(c,"SELECT COALESCE((SELECT SUM(amount) FROM credit_receipts WHERE created_at >= $from AND created_at < $to),0)-COALESCE((SELECT SUM(amount) FROM credit_receipt_reversals WHERE created_at >= $from AND created_at < $to),0)",from,to,ct);''',
    "credit summary net of dated reversals")
s=once(s,
    'WHERE s.cash_session_id=$id AND p.method=\'StoreCredit\'"',
    'WHERE s.cash_session_id=$id AND s.status=\'Completed\' AND p.method=\'StoreCredit\'"',
    "closed cash excludes cancelled credit")
s=once(s,
    'q.CommandText="SELECT id,amount,method,created_at,notes FROM credit_receipts WHERE account_id=$id ORDER BY created_at";',
    '''q.CommandText="SELECT r.id,r.amount,r.method,r.created_at,CASE WHEN x.id IS NULL THEN r.notes ELSE COALESCE(r.notes,'') || ' [ESTORNADO: ' || x.reason || ']' END FROM credit_receipts r LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id WHERE r.account_id=$id ORDER BY r.created_at";''',
    "show reversals clearly in credit audit")
p.write_text(s,encoding="utf-8")

p=i/"FinalFeaturesService.cs";s=p.read_text(encoding="utf-8-sig")
s=once(s,
 'var receipts=await S("SELECT COALESCE(SUM(amount),0) FROM credit_receipts WHERE created_at >= $from AND created_at < $to");',
 'var receipts=await S("SELECT COALESCE((SELECT SUM(amount) FROM credit_receipts WHERE created_at >= $from AND created_at < $to),0)-COALESCE((SELECT SUM(amount) FROM credit_receipt_reversals WHERE created_at >= $from AND created_at < $to),0)");',
 "managerial report net receipts")
p.write_text(s,encoding="utf-8")

# UI: one confirmation cannot start a second operation while the first runs.
p=d/"CreditWindow.xaml.cs";s=p.read_text(encoding="utf-8-sig")
s=once(s,"    private async void Receive_Click(object sender, RoutedEventArgs e)\n    {",
'''    private bool _receiving045;
    private async void Receive_Click(object sender, RoutedEventArgs e)
    {
        if(_receiving045)return;
        _receiving045=true;
        try
        {''',
"receive reentrancy guard")
s=once(s,
  '                .ReceiveAsync(account.Id, window.Amount, window.Method, _operator, session.Id, window.Notes);',
  '                .ReceiveOnceAsync(account.Id, window.Amount, window.Method, _operator, session.Id, window.Notes, requestId);',
  "credit unique request ID on actual UI")
s=once(s,'            var receipt = await new SqliteCreditRepository(_db, new SystemClock())',
         '            var requestId=Guid.NewGuid();\n            var receipt = await new SqliteCreditRepository(_db, new SystemClock())',
         "capture request identity once")
# Insert outer finally at the end of Receive_Click using next member anchor (brace balance).
a=s.index('    private async void Receive_Click(')
brace=s.index('{',a)
depth=1;j=brace+1
while depth and j<len(s):
    if s[j]=='{':depth+=1
    elif s[j]=='}':depth-=1
    j+=1
if depth:raise RuntimeError("receive braces")
body=s[brace+1:j-1]
s=s[:brace+1]+body+'\n        }\n        finally{_receiving045=false;}\n    '+s[j-1:]
p.write_text(s,encoding="utf-8")

(t/"CreditIntegrity045Tests.cs").write_text(Path("scripts/feature045_credit_tests.cs").read_text(encoding="utf-8"),encoding="utf-8")
print("ONCA_CREDIT_INTEGRITY_045_APPLIED=YES")
