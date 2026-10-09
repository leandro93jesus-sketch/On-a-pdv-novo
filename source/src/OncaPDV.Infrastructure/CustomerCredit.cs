using Microsoft.Data.Sqlite;using OncaPDV.Application;using OncaPDV.Domain;
namespace OncaPDV.Infrastructure;
public sealed class SqliteCustomerRepository(OncaDatabase db):ICustomerRepository
{
 public async Task SaveAsync(CustomerProfile x,CancellationToken ct=default){if(!BrazilianTaxId.IsValid(x.Cpf)||!BrazilianTaxId.IsValid(x.Cnpj))throw new DomainException("CPF/CNPJ inválido.");await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="INSERT INTO customers(id,name,cpf,cnpj,phone,whatsapp,email,postal_code,address,number,complement,district,city,state,notes,active) VALUES($id,$name,$cpf,$cnpj,$phone,$wa,$email,$cep,$address,$number,$complement,$district,$city,$state,$notes,$active) ON CONFLICT(id) DO UPDATE SET name=excluded.name,cpf=excluded.cpf,cnpj=excluded.cnpj,phone=excluded.phone,whatsapp=excluded.whatsapp,email=excluded.email,postal_code=excluded.postal_code,address=excluded.address,number=excluded.number,complement=excluded.complement,district=excluded.district,city=excluded.city,state=excluded.state,notes=excluded.notes,active=excluded.active";Add(q,x);try{await q.ExecuteNonQueryAsync(ct);}catch(SqliteException ex)when(ex.SqliteErrorCode==19){throw new DuplicateCustomerException("CPF ou CNPJ já cadastrado.");}}
 public async Task<IReadOnlyList<CustomerProfile>> SearchAsync(string term,bool includeInactive=false,CancellationToken ct=default){var list=new List<CustomerProfile>();await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT * FROM customers WHERE ($all=1 OR active=1) AND (name LIKE $q OR phone LIKE $q OR cpf LIKE $q OR cnpj LIKE $q) ORDER BY name LIMIT 100";q.Parameters.AddWithValue("$all",includeInactive?1:0);q.Parameters.AddWithValue("$q",$"%{term}%");await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(Read(r));return list;}
 public async Task<CustomerProfile?> GetAsync(Guid id,CancellationToken ct=default){await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT * FROM customers WHERE id=$id";q.Parameters.AddWithValue("$id",id.ToString());await using var r=await q.ExecuteReaderAsync(ct);return await r.ReadAsync(ct)?Read(r):null;}
 private static void Add(SqliteCommand q,CustomerProfile x){var values=new Dictionary<string,object?>{{"$id",x.Id.ToString()},{"$name",x.Name},{"$cpf",x.Cpf},{"$cnpj",x.Cnpj},{"$phone",x.Phone},{"$wa",x.WhatsApp},{"$email",x.Email},{"$cep",x.PostalCode},{"$address",x.Address},{"$number",x.Number},{"$complement",x.Complement},{"$district",x.District},{"$city",x.City},{"$state",x.State},{"$notes",x.Notes},{"$active",x.Active?1:0}};foreach(var p in values)q.Parameters.AddWithValue(p.Key,p.Value??DBNull.Value);}
 private static CustomerProfile Read(SqliteDataReader r){string? T(string n){var i=r.GetOrdinal(n);return r.IsDBNull(i)?null:r.GetString(i);}return new(Guid.Parse(T("id")!),T("name")!,T("cpf"),T("cnpj"),T("phone"),T("whatsapp"),T("email"),T("postal_code"),T("address"),T("number"),T("complement"),T("district"),T("city"),T("state"),T("notes"),r.GetInt32(r.GetOrdinal("active"))==1);}
}
public sealed class SqliteCreditRepository(OncaDatabase db,IClock clock):ICreditRepository
{
 public async Task<IReadOnlyList<CreditAccount>> ByCustomerAsync(Guid customerId,CancellationToken ct=default){var list=new List<CreditAccount>();await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText=@"SELECT a.* FROM credit_accounts a JOIN sales s ON s.id=a.sale_id WHERE a.customer_id=$id AND NOT EXISTS(SELECT 1 FROM credit_account_deletions_046 d WHERE d.account_id=a.id) ORDER BY a.due_at";q.Parameters.AddWithValue("$id",customerId.ToString());await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(Read(r));return list;}
   // API compatibility: ordinary legitimate payments obtain a fresh request ID.
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
WHERE a.id=$id AND a.status NOT IN ('Paid','Cancelled') AND s.status='Completed' AND NOT EXISTS(SELECT 1 FROM credit_account_deletions_046 d WHERE d.account_id=a.id)";
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

  private static async Task Exec(SqliteConnection c,SqliteTransaction tx,string sql,params(string,object)[] ps){await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;foreach(var p in ps)q.Parameters.AddWithValue(p.Item1,p.Item2 is Guid id?id.ToString():p.Item2);await q.ExecuteNonQueryAsync();}
 private static CreditAccount Read(SqliteDataReader r)=>new(Guid.Parse(r.GetString(r.GetOrdinal("id"))),Guid.Parse(r.GetString(r.GetOrdinal("customer_id"))),Guid.Parse(r.GetString(r.GetOrdinal("sale_id"))),r.GetDecimal(r.GetOrdinal("original_amount")),r.GetDecimal(r.GetOrdinal("balance")),DateTimeOffset.Parse(r.GetString(r.GetOrdinal("created_at"))),DateTimeOffset.Parse(r.GetString(r.GetOrdinal("due_at"))),Enum.Parse<CreditStatus>(r.GetString(r.GetOrdinal("status"))),r.GetInt32(r.GetOrdinal("installments")),r.IsDBNull(r.GetOrdinal("notes"))?null:r.GetString(r.GetOrdinal("notes")));
}
