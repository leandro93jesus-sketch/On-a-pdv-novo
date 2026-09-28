from pathlib import Path

root=Path("work-final/ONCA-PDV-PRO").resolve()
i=root/"src"/"OncaPDV.Infrastructure"
d=root/"src"/"OncaPDV.Desktop"
t=root/"tests"/"OncaPDV.Tests"

def once(s,a,b,name):
    count=s.count(a)
    if count!=1: raise RuntimeError(f"{name}: expected one anchor; got {count}")
    return s.replace(a,b,1)

# Additional tables only, no alterations to old rows or columns.
p=i/"Database.cs";s=p.read_text(encoding="utf-8-sig")
anchor='''            creditMigration.ExecuteNonQuery();
        }
        using(var q=c.CreateCommand()){'''
replace='''            creditMigration.ExecuteNonQuery();
            creditMigration.CommandText=@"CREATE TABLE IF NOT EXISTS credit_account_deletions_046(
account_id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,removed_balance NUMERIC NOT NULL,
net_paid NUMERIC NOT NULL,operator_id TEXT NOT NULL,reason TEXT NOT NULL,
created_at TEXT NOT NULL,FOREIGN KEY(account_id) REFERENCES credit_accounts(id),
FOREIGN KEY(sale_id) REFERENCES sales(id));
CREATE TABLE IF NOT EXISTS credit_receipt_intents_046(
request_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,amount NUMERIC NOT NULL,
method TEXT NOT NULL,operator_id TEXT NOT NULL,session_id TEXT NOT NULL,
notes TEXT,created_at TEXT NOT NULL,acknowledged_at TEXT,
FOREIGN KEY(account_id) REFERENCES credit_accounts(id));
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_pending_intent_046
ON credit_receipt_intents_046(account_id) WHERE acknowledged_at IS NULL;";
            creditMigration.ExecuteNonQuery();
        }
        using(var q=c.CreateCommand()){'''
s=once(s,anchor,replace,"credit safety migration")
p.write_text(s,encoding="utf-8")

(i/"CreditSafety046.cs").write_text(Path("scripts/feature046_credit_safety.cs").read_text(encoding="utf-8"),encoding="utf-8")
(d/"CreditExclusion046Window.xaml").write_text(Path("scripts/feature046_credit_delete.xaml").read_text(encoding="utf-8"),encoding="utf-8")
(d/"CreditExclusion046Window.xaml.cs").write_text(Path("scripts/feature046_credit_delete.xaml.cs").read_text(encoding="utf-8"),encoding="utf-8")

# Exclusion credits the uncollected balance. A later sale cancellation credits only
# the still unreversed part (e.g. already received amount); never the full total again.
p=i/"AdvancedOperations.cs";s=p.read_text(encoding="utf-8-sig")
needle='''await Exec(c,tx,"INSERT INTO credit_entries VALUES($id,(SELECT customer_id FROM credit_accounts WHERE id=$account),$sale,'Credit',(SELECT original_amount FROM credit_accounts WHERE id=$account),NULL,$at,'CANCELAMENTO VENDA CREDIÁRIO')",ct,("$id",Guid.NewGuid()),("$account",account),("$sale",saleId),("$at",now));'''
replacement='''await Exec(c,tx,@"INSERT INTO credit_entries
(id,customer_id,sale_id,type,amount,due_at,created_at,reason)
SELECT $id,a.customer_id,$sale,'Credit',
a.original_amount-COALESCE(d.removed_balance,0),NULL,$at,'CANCELAMENTO VENDA CREDIÁRIO'
FROM credit_accounts a LEFT JOIN credit_account_deletions_046 d ON d.account_id=a.id
WHERE a.id=$account AND a.original_amount-COALESCE(d.removed_balance,0)>0",ct,
("$id",Guid.NewGuid()),("$account",account),("$sale",saleId),("$at",now));'''
s=once(s,needle,replacement,"avoid double writeoff on later cancelled sale")
p.write_text(s,encoding="utf-8")

p=i/"OperationalServices.cs";s=p.read_text(encoding="utf-8-sig")
s=once(s,
    "FROM credit_accounts a JOIN customers c ON c.id=a.customer_id JOIN sales s ON s.id=a.sale_id",
    "FROM credit_accounts a LEFT JOIN credit_account_deletions_046 d ON d.account_id=a.id JOIN customers c ON c.id=a.customer_id JOIN sales s ON s.id=a.sale_id",
    "credit account deletion left join")
s=once(s,
    "SELECT a.id,a.customer_id,c.name,s.number,a.original_amount,a.balance,a.due_at,a.status",
    "SELECT a.id,a.customer_id,c.name,s.number,a.original_amount,a.balance,a.due_at,a.status,d.removed_balance",
    "paid history query")
s=once(s,
    "($status='Todos' AND a.status<>'Cancelled' OR a.status=$status OR ($status='Overdue' AND a.balance>0 AND a.due_at<$now))",
    "($status='Todos' AND a.status<>'Cancelled' OR ($status='Excluídos' AND d.account_id IS NOT NULL) OR ($status NOT IN ('Todos','Excluídos') AND a.status=$status) OR ($status='Overdue' AND a.balance>0 AND a.due_at<$now))",
    "filter excludes deleted but can show audit")
s=once(s,
    "var original=r.GetDecimal(4);var balance=r.GetDecimal(5);list.Add(new(Guid.Parse(r.GetString(0)),Guid.Parse(r.GetString(1)),r.GetString(2),r.GetInt64(3),original,original-balance,balance,due,st));",
    "var original=r.GetDecimal(4);var balance=r.GetDecimal(5);var paid=r.IsDBNull(8)?original-balance:original-r.GetDecimal(8);list.Add(new(Guid.Parse(r.GetString(0)),Guid.Parse(r.GetString(1)),r.GetString(2),r.GetInt64(3),original,paid,balance,due,st));",
    "accurate paid value for excluded debt")
p.write_text(s,encoding="utf-8")

p=d/"CreditWindow.xaml";x=p.read_text(encoding="utf-8-sig")
filter_button='<Button Style="{StaticResource FilterButton}" Content="PAGOS" Tag="Paid" Click="FilterButton_Click"/>'
x=once(x,filter_button,filter_button+'''
                    <Button Style="{StaticResource FilterButton}" Content="EXCLUÍDOS" Tag="Excluídos" Click="FilterButton_Click"/>''',"excluded credit filter button")
marker='Content="🗑  ESTORNAR RECEBIMENTO"'
pos=x.index(marker)
end=x.index('/>',pos)+2
x=x[:end]+'''
                        <Button Style="{StaticResource RoundedButton}" Content="EXCLUIR CREDIÁRIO" Click="DeleteCredit046_Click" MinHeight="48" Margin="0,8,0,0" Background="#9C2820" Foreground="White" FontWeight="Bold" ToolTip="Exclusão administrativa da conta; não apaga pagamentos nem movimento do caixa."/>
                        <Button Style="{StaticResource SoftButton}" Content="CONFERIR RECEBIMENTOS / CAIXA" Click="CheckCreditCash046_Click" MinHeight="42" Margin="0,6,0,0"/>'''+x[end:]
p.write_text(x,encoding="utf-8")

p=d/"CreditWindow.xaml.cs";s=p.read_text(encoding="utf-8-sig")
a=s.index("    private async void Receive_Click(")
b=s.index("    private async void Pdf_Click(",a)
replacement=r'''    private bool _adminAction046;
    private async Task ProcessReceipt046(CreditIntent046 intent,Guid customerId,decimal previousBalance)
    {
        var repository=new SqliteCreditRepository(_db,new SystemClock());
        var receipt=await repository.ReceiveOnceAsync(intent.AccountId,intent.Amount,intent.Method,
            intent.OperatorId,intent.SessionId,intent.Notes,intent.RequestId);
        var safety=new CreditSafety046(_db);
        var cash=await safety.CheckAsync(intent)
            ??throw new InvalidOperationException("O recebimento ainda não aparece no caixa. Não lance outra baixa; confira a operação pendente.");
        await Refresh();
        var updated=(await _ops.CreditsAsync("Todos",customerId))
            .First(x=>x.Id==intent.AccountId);
        var summary=await safety.ReconcileAsync(intent.AccountId);
        if(!summary.Matches)
            throw new InvalidOperationException("O recebimento foi registrado, mas há divergência no caixa. Confira o extrato antes de uma nova baixa.");
        var answer=MessageBox.Show(
            $"RECEBIMENTO CONFIRMADO UMA VEZ\n\nCliente: {updated.Customer}\n" +
            $"Saldo anterior: {previousBalance:C}\nRecebido: {receipt.Amount:C}\nSaldo restante: {updated.Balance:C}\n" +
            $"Recibo: {cash.ReceiptId}\nMovimento de caixa: {cash.CashMovementId}\n" +
            $"Total ativo recebido nesta conta: {summary.ActiveReceipts:C}\nTotal líquido lançado no caixa: {summary.CashNet:C}\n\n" +
            "Os valores foram conferidos. Deseja gerar o comprovante em PDF?",
            "Crediário — caixa conferido",MessageBoxButton.YesNo,MessageBoxImage.Information);
        await safety.AcknowledgeAsync(intent);
        if(answer==MessageBoxResult.Yes)
        {
            var pdf=await _ops.ReceiptPdfAsync(updated,receipt);
            MessageBox.Show($"COMPROVANTE GERADO\n\n{pdf}","Crediário",MessageBoxButton.OK,MessageBoxImage.Information);
        }
    }

    private async void Receive_Click(object sender,RoutedEventArgs e)
    {
        if(_receiving045||_adminAction046)return;
        _receiving045=true;
        try
        {
            if(Accounts.SelectedItem is not CreditView account)
            {
                MessageBox.Show("Selecione uma conta de crediário.","Crediário");
                return;
            }
            var safety=new CreditSafety046(_db);
            var pending=await safety.PendingAsync(account.Id);
            if(pending is not null)
            {
                var posted=await safety.CheckAsync(pending);
                if(posted is not null)
                {
                    MessageBox.Show($"ESTE PAGAMENTO JÁ FOI REGISTRADO.\n\nValor: {posted.Amount:C}\n" +
                        $"Recibo: {posted.ReceiptId}\nMovimento no caixa: {posted.CashMovementId}\n\n" +
                        "Nenhuma nova baixa foi efetuada. A operação anterior será marcada como conferida.",
                        "Recebimento anterior encontrado",MessageBoxButton.OK,MessageBoxImage.Information);
                    await safety.AcknowledgeAsync(pending);
                    await Refresh();
                    return;
                }
                if(!await safety.SessionOpenAsync(pending.SessionId))
                {
                    MessageBox.Show("Existe uma operação anterior sem recibo e o caixa original está fechado. Não haverá baixa automática. Solicite revisão antes de continuar.","Crediário — pendência",MessageBoxButton.OK,MessageBoxImage.Warning);
                    return;
                }
                if(MessageBox.Show($"Há uma operação pendente de {pending.Amount:C} ({pending.Method}).\n" +
                    "Deseja RETOMAR o mesmo identificador? Isso impede um segundo lançamento se o anterior já tiver sido gravado.",
                    "Recebimento pendente",MessageBoxButton.YesNo,MessageBoxImage.Question)==MessageBoxResult.Yes)
                {
                    await ProcessReceipt046(pending,account.CustomerId,account.Balance);
                    return;
                }
                if(MessageBox.Show("Descartar somente esta operação ainda NÃO GRAVADA? Não será removido qualquer recebimento já registrado.","Pendência",MessageBoxButton.YesNo,MessageBoxImage.Warning)==MessageBoxResult.Yes)
                    await safety.AbandonUncommittedAsync(pending);
                return;
            }
            if(account.Status==CreditStatus.Cancelled||account.Balance<=0)
            {
                MessageBox.Show("Esta conta está paga, excluída ou cancelada; não pode receber nova baixa.","Crediário");
                return;
            }
            var window=new ReceiveCreditWindow(account){Owner=this};
            if(window.ShowDialog()!=true)return;
            var session=await new SqliteCashSessionRepository(_db,new SystemClock()).GetOrOpenAsync(_operator);
            var intent=await safety.PrepareAsync(account.Id,window.Amount,window.Method,_operator,session.Id,window.Notes);
            await ProcessReceipt046(intent,account.CustomerId,account.Balance);
        }
        catch(Exception ex)
        {
            MessageBox.Show(ex.Message+"\n\nNão tente lançar novamente sem conferir os recebimentos e o caixa.","Crediário — verifique antes de nova baixa",MessageBoxButton.OK,MessageBoxImage.Warning);
        }
        finally{_receiving045=false;}
    }

'''
s=s[:a]+replacement+s[b:]
s=once(s,
  "SelectedStatusText.Text = StatusLabel(account.Status);",
  'SelectedStatusText.Text = _status=="Excluídos"?"Excluído (auditado)":StatusLabel(account.Status);',
  "show deleted credit status")
insert_anchor='    private async void WhatsApp_Click('
methods=r'''    private async void DeleteCredit046_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        _adminAction046=true;
        try
        {
            if(Accounts.SelectedItem is not CreditView account)
            {
                MessageBox.Show("Selecione a conta que deseja excluir.","Crediário");
                return;
            }
            if(account.Status==CreditStatus.Cancelled)
            {
                MessageBox.Show("Esta conta já está cancelada ou excluída.","Crediário");
                return;
            }
            var safety=new CreditSafety046(_db);
            var pending=await safety.PendingAsync(account.Id);
            if(pending is not null)
            {
                MessageBox.Show("Existe recebimento aguardando conferência. Confira-o antes de excluir a conta.","Crediário",MessageBoxButton.OK,MessageBoxImage.Warning);
                return;
            }
            var auth=new AdminAuthorization040Window(_db){Owner=this};
            if(auth.ShowDialog()!=true)return;
            var reason=new CreditExclusion046Window(account.Customer,account.SaleNumber,account.Balance,account.Paid){Owner=this};
            if(reason.ShowDialog()!=true)return;
            if(MessageBox.Show(
                $"CONFIRMAR EXCLUSÃO DO CREDIÁRIO?\n\nCliente: {account.Customer}\nVenda {account.SaleNumber:000000}\n" +
                $"Saldo a baixar: {account.Balance:C}\nPagamentos existentes preservados: {account.Paid:C}\n\n" +
                "Não apaga a venda. Não retira dinheiro do caixa. Operação auditada e sem retorno automático.",
                "EXCLUIR CREDIÁRIO",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
            var result=await safety.DeleteCreditAsync(account.Id,_operator,
                $"ADMIN: {auth.AuthorizedName} | MOTIVO: {reason.Reason}");
            await Refresh();
            MessageBox.Show($"Conta excluída da lista ativa.\nSaldo baixado: {result.Forgiven:C}\n" +
                $"Pagamentos legítimos preservados: {result.Paid:C}\n" +
                "Consulte o filtro EXCLUÍDOS para auditoria.","Crediário",MessageBoxButton.OK,MessageBoxImage.Information);
        }
        catch(Exception ex)
        {
            MessageBox.Show("Crediário não excluído.\n\n"+ex.Message,"Crediário",MessageBoxButton.OK,MessageBoxImage.Warning);
        }
        finally{_adminAction046=false;}
    }

    private async void CheckCreditCash046_Click(object sender,RoutedEventArgs e)
    {
        if(Accounts.SelectedItem is not CreditView account)return;
        try
        {
            var audit=await new CreditSafety046(_db).ReconcileAsync(account.Id);
            var note=!audit.Matches
                ?"DIVERGÊNCIA: não faça nova baixa antes de revisar os lançamentos."
                :!audit.AllIndividuallyLinked
                    ?"O TOTAL CONFERE, mas há recibos antigos sem vínculo individual; confira o histórico antes de afirmar que cada lançamento está correto."
                    :"CONFERIDO: total líquido e vínculos individuais dos recebimentos conferem.";
            MessageBox.Show($"Cliente: {account.Customer}\nRecebimentos líquidos: {audit.ActiveReceipts:C}\n" +
                $"Movimentos líquidos no caixa: {audit.CashNet:C}\n" +
                $"Recibos: {audit.Receipts} / vinculados: {audit.LinkedReceipts}\n\n{note}",
                "Conferência de crediário e caixa",MessageBoxButton.OK,
                audit.Matches?MessageBoxImage.Information:MessageBoxImage.Warning);
        }
        catch(Exception ex){MessageBox.Show(ex.Message,"Conferência",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

'''
s=once(s,insert_anchor,methods+insert_anchor,"credit account delete UI")
# Protect admin modifications while an earlier receipt or delete is running.
for method,nextMethod in [
    ("EditReceipt_Click","ReverseReceipt_Click"),
    ("ReverseReceipt_Click","DeleteCredit046_Click")
]:
    a=s.index("    private async void "+method+"(")
    b=s.index("    private async void "+nextMethod+"(",a)
    body=s[a:b]
    brace=body.index("{")
    if method=="ReverseReceipt_Click":
        # The previous method is kept verbatim inside a single guard.
        pass
    old=body[brace+1:]
    close=old.rfind("}")
    if close<0:raise RuntimeError("Missing method end "+method)
    guarded='''
        if(_adminAction046||_receiving045)return;
        _adminAction046=true;
        try
        {
'''+old[:close]+'''
        }
        finally{_adminAction046=false;}
    '''+old[close:]
    s=s[:a]+body[:brace+1]+guarded+s[b:]
p.write_text(s,encoding="utf-8")
(t/"CreditSafety046Tests.cs").write_text(Path("scripts/feature046_credit_tests.cs").read_text(encoding="utf-8"),encoding="utf-8")
print("ONCA_CREDIT_SAFETY_046_APPLIED=YES")
