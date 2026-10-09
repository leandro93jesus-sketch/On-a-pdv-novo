using System.Windows;
using System.Windows.Controls;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class CreditWindow : Window
{
    private readonly OncaDatabase _db;
    private readonly Guid _operator;
    private readonly Guid? _customer;
    private readonly OperationalService _ops;
    private IReadOnlyList<CreditView> _current = [];
    private string _status = "Todos";

    public CreditWindow(OncaDatabase db, Guid operatorId) : this(db, null, operatorId) { }

    public CreditWindow(OncaDatabase db, Guid customerId, bool customerFilter)
        : this(db, customerFilter ? customerId : null, Guid.Parse("10000000-0000-0000-0000-000000000001")) { }

    private CreditWindow(OncaDatabase db, Guid? customer, Guid op)
    {
        _db = db;
        _operator = op;
        _customer = customer;
        _ops = new(db, AppServices.Paths);
        InitializeComponent();
        Loaded += async (_, _) => await Refresh();
    }

    private async Task Refresh()
    {
        // A fresh DB query, not the previous WPF ItemsSource, defines active accounts.
        _current = await _ops.CreditsAsync(_status, _customer);
        Accounts.ItemsSource = null;
        ApplySearch();
        UpdateSummary(_current);
    }

    private void ApplySearch()
    {
        if (Accounts is null) return;
        // Never silently carry a checked account across filter/search changes.
        foreach (var account in _current) account.MarkedForBulk048 = false;
        if (MarkedCount048 is not null) MarkedCount048.Text = "0 marcadas";
        var term = SearchBox?.Text?.Trim() ?? string.Empty;
        Accounts.ItemsSource = string.IsNullOrWhiteSpace(term)
            ? _current
            : _current.Where(x => x.Customer.Contains(term, StringComparison.CurrentCultureIgnoreCase)).ToArray();
    }

    private void UpdateSummary(IReadOnlyList<CreditView> items)
    {
        TotalOpenText.Text = items.Where(x => x.Status is not CreditStatus.Paid and not CreditStatus.Cancelled).Sum(x => x.Balance).ToString("C");
        TotalPaidText.Text = items.Sum(x => x.Paid).ToString("C");
        OverdueText.Text = items.Count(x => x.Status == CreditStatus.Overdue).ToString();
        AccountsCountText.Text = items.Count.ToString();
    }

    private async void FilterButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button) return;
        _status = Convert.ToString(button.Tag) ?? "Todos";
        ActiveFilterText.Text = $"Filtro: {button.Content}";
        await Refresh();
    }

    private void Search_Changed(object sender, TextChangedEventArgs e) => ApplySearch();

    private async void Audit049_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        _adminAction046=true;
        try
        {
            var auth=new AdminAuthorization040Window(_db){Owner=this};
            if(auth.ShowDialog()!=true)return;
            new CreditAudit049Window(_db,_customer){Owner=this}.ShowDialog();
            await Refresh();
        }
        catch(Exception ex){MessageBox.Show(ex.Message,"Auditoria",MessageBoxButton.OK,MessageBoxImage.Warning);}
        finally{_adminAction046=false;}
    }

    private void ShowActiveAfterRemoval049()
    {
        _status="Todos";
        ActiveFilterText.Text="Filtro: ATIVOS (em aberto, parcial ou vencido)";
        SearchBox.Clear();
        Accounts.SelectedItem=null;
    }

    private async void Account_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (Accounts.SelectedItem is not CreditView account)
        {
            Movements.ItemsSource = null;
            SelectedCustomerText.Text = "Selecione uma conta";
            SelectedSaleText.Text = "Venda: —";
            SelectedOriginalText.Text = 0m.ToString("C");
            SelectedPaidText.Text = 0m.ToString("C");
            SelectedBalanceText.Text = 0m.ToString("C");
            SelectedDueText.Text = "—";
            SelectedStatusText.Text = "—";
            return;
        }

        SelectedCustomerText.Text = account.Customer;
        SelectedSaleText.Text = $"Venda: {account.SaleNumber:000000}";
        SelectedOriginalText.Text = account.Original.ToString("C");
        SelectedPaidText.Text = account.Paid.ToString("C");
        SelectedBalanceText.Text = account.Balance.ToString("C");
        SelectedDueText.Text = account.DueAt.ToString("dd/MM/yyyy");
        SelectedStatusText.Text = _status=="Excluídos"?"Excluído (auditado)":StatusLabel(account.Status);
        Movements.ItemsSource = await _ops.CreditMovementsAsync(account.Id);
    }

    private CreditView[] MarkedAccounts048() => Accounts.Items.OfType<CreditView>()
        .Where(a=>a.MarkedForBulk048).ToArray();

    private void UpdateMarkedCount048() => MarkedCount048.Text=$"{MarkedAccounts048().Length} marcadas";

    private void MarkChanged048_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)
        {
            if(sender is CheckBox cb && cb.DataContext is CreditView account) account.MarkedForBulk048=false;
            Accounts.Items.Refresh();
            return;
        }
        UpdateMarkedCount048();
    }

    private void MarkAll048_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        foreach(var account in Accounts.Items.OfType<CreditView>())
            account.MarkedForBulk048=true;
        Accounts.Items.Refresh();UpdateMarkedCount048();
    }

    private void ClearMarks048_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        foreach(var account in _current)account.MarkedForBulk048=false;
        Accounts.Items.Refresh();UpdateMarkedCount048();
    }

    private async Task ArchiveSelected050(IReadOnlyList<CreditView> selected)
    {
        var archive=new CreditArchive050(_db);
        var ids=selected.Select(x=>x.Id).Distinct().ToArray();
        var preview=await archive.InspectAsync(ids);
        if(preview.BlockedCount>0)
        {
            MessageBox.Show("Exclusão bloqueada APENAS para evitar risco financeiro.\n"+
                "Nenhuma conta foi alterada.\n\n"+preview.Details,
                "Crediário — conferência necessária",MessageBoxButton.OK,MessageBoxImage.Warning);
            return;
        }
        var auth=new AdminAuthorization040Window(_db){Owner=this};
        if(auth.ShowDialog()!=true)return;
        var reasonWindow=new CreditExclusion046Window(preview.Total,preview.Balance,preview.Paid){Owner=this};
        if(reasonWindow.ShowDialog()!=true)return;
        var sample=string.Join("\n",preview.Items.Take(10).Select(x=>
            $"{x.Label} — saldo {x.Balance:C}"));
        if(preview.Total>10)sample+=$"\n... e mais {preview.Total-10} contas";
        var allow=false;
        if(preview.WarningCount>0)
        {
            var note=preview.Details.Length>2800?preview.Details[..2800]+"...":preview.Details;
            if(MessageBox.Show(
                $"ATENÇÃO: {preview.WarningCount} conta(s) contêm dados antigos que exigem revisão.\n\n{note}\n\n"+
                "CONFIRMA ARQUIVAR MESMO COM ESSES ALERTAS?\n"+
                "A operação NÃO corrige diferenças de caixa, NÃO apaga recibos nem vendas e registra o alerta na auditoria.\n"+
                "O saldo operacional da conta será encerrado; se houver diferença financeira, ela continuará indicada para conferência.",
                "CONFIRMAÇÃO ADMINISTRATIVA — DADOS LEGADOS",
                MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
            allow=true;
        }
        if(MessageBox.Show(
            $"RETIRAR {preview.NewCount} CONTA(S) DO CREDIÁRIO?\n\n{sample}\n\n"+
            $"Saldo a encerrar: {preview.Balance:C}\nRecebimentos históricos preservados: {preview.Paid:C}\n"+
            $"Já arquivadas: {preview.Total-preview.NewCount}\n\n"+
            "Autorização e motivo serão registrados. Nenhum pagamento será lançado ou estornado.",
            "CONFIRMAR EXCLUSÃO",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
        var result=await archive.ArchiveAsync(ids,_operator,
            $"ADMIN: {auth.AuthorizedName} | MOTIVO: {reasonWindow.Reason}",allow);
        ShowActiveAfterRemoval049();
        await Refresh();
        if(selected.Any(x=>_current.Any(active=>active.Id==x.Id)))
            throw new InvalidOperationException("Há uma conta ainda visível após a baixa. Confira auditoria antes de repetir.");
        var text=$"EXCLUSÃO CONFERIDA NO BANCO\n\n"+
            $"Novas contas arquivadas: {result.Archived}\nJá arquivadas anteriormente: {result.AlreadyArchived}\n"+
            $"Saldo baixado contabilmente: {result.WrittenOff:C}\n"+
            $"Recebimentos preservados: {result.Paid:C}\n"+
            $"Contas com alertas históricos: {result.WithAlerts}\n"+
            $"Lote: {result.BatchId}\n\n"+
            "Para conferência, abra AUDITORIA. O caixa não foi alterado.";
        MessageBox.Show(text,"Crediário — exclusão concluída",MessageBoxButton.OK,
            result.WithAlerts>0?MessageBoxImage.Warning:MessageBoxImage.Information);
    }

    private async void DeleteMarked048_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        _adminAction046=true;
        try
        {
            var selected=MarkedAccounts048();
            if(selected.Length==0){MessageBox.Show("Marque as contas na primeira coluna.","Crediário");return;}
            await ArchiveSelected050(selected);
        }
        catch(Exception ex)
        {
            MessageBox.Show("Nenhuma nova baixa deve ser repetida sem conferir a auditoria.\n\n"+ex.Message,
                "Crediário — atenção",MessageBoxButton.OK,MessageBoxImage.Warning);
        }
        finally{_adminAction046=false;UpdateMarkedCount048();}
    }

    private bool _receiving045;
    private bool _adminAction046;
    private async Task ProcessReceipt046(CreditIntent046 intent,Guid customerId,decimal previousBalance)
    {
        var repository=new SqliteCreditRepository(_db,new SystemClock());
        var receipt=await repository.ReceiveOnceAsync(intent.AccountId,intent.Amount,intent.Method,
            intent.OperatorId,intent.SessionId,intent.Notes,intent.RequestId);
        var safety=new CreditSafety046(_db);
        var cash=await safety.CheckAsync(intent)
            ??throw new InvalidOperationException("O recebimento ainda não aparece no caixa. Não lance outra baixa; confira a operação pendente.");
        await Refresh();
        // Fully paid accounts leave ATIVOS immediately, but PAGOS remains available for receipt/history.
        var updated=(await _ops.CreditsAsync("Todos",customerId)).FirstOrDefault(x=>x.Id==intent.AccountId)
            ??(await _ops.CreditsAsync("Paid",customerId)).FirstOrDefault(x=>x.Id==intent.AccountId)
            ??throw new InvalidOperationException("O recebimento foi gravado, mas a conta não pôde ser localizada para conferência.");
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
        if(updated.Balance<=0 && (await _ops.CreditsAsync("Todos",customerId)).Any(x=>x.Id==intent.AccountId))
            throw new InvalidOperationException("A conta foi quitada, mas ainda aparece na lista ativa. Não repita a baixa; abra a auditoria.");
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

    private async void Pdf_Click(object sender, RoutedEventArgs e)
    {
        if (Accounts.SelectedItem is not CreditView account)
        {
            MessageBox.Show("Selecione uma conta para gerar o extrato.", "Crediário", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var pdf = await _ops.CreditPdfAsync(account, await _ops.CreditMovementsAsync(account.Id));
        MessageBox.Show($"EXTRATO GERADO\n\n{pdf}", "Crediário", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void EditReceipt_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        _adminAction046=true;
        try
        {

        if(Accounts.SelectedItem is not CreditView account || Movements.SelectedItem is not CreditMovement movement){MessageBox.Show("Selecione a conta e o recebimento que deseja corrigir.","Crediário");return;}
        var raw=Microsoft.VisualBasic.Interaction.InputBox($"Valor atual: {movement.Amount:C}\n\nDigite o novo valor:","Editar recebimento",movement.Amount.ToString("N2"));
        var culture=System.Globalization.CultureInfo.GetCultureInfo("pt-BR");if(!decimal.TryParse(raw,System.Globalization.NumberStyles.Number,culture,out var amount)||amount<=0){MessageBox.Show("Valor inválido.");return;}
        var reason=Microsoft.VisualBasic.Interaction.InputBox("Motivo da correção (obrigatório):","Editar recebimento","");if(string.IsNullOrWhiteSpace(reason))return;
        if(MessageBox.Show($"Corrigir {movement.Amount:C} para {amount:C}?\n\nO lançamento antigo será estornado com auditoria e um novo recebimento será criado.","Crediário",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
        try{
            await new AdvancedOperationsService(_db).ReverseCreditReceiptAsync(movement.Id,_operator,"CORREÇÃO: "+reason.Trim());
            var session=await new SqliteCashSessionRepository(_db,new SystemClock()).GetOrOpenAsync(_operator);
            await new SqliteCreditRepository(_db,new SystemClock()).ReceiveAsync(account.Id,amount,movement.Method,_operator,session.Id,$"CORREÇÃO DO RECEBIMENTO {movement.Id}: {reason.Trim()}");
            await Refresh();MessageBox.Show("Recebimento corrigido. O histórico anterior foi preservado e o caixa/saldo foram recalculados.","Crediário");
        }catch(Exception ex){MessageBox.Show(ex.Message,"Crediário",MessageBoxButton.OK,MessageBoxImage.Warning);}
    
        }
        finally{_adminAction046=false;}
    }

    private async void ReverseReceipt_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        _adminAction046=true;
        try
        {

        if(Movements.SelectedItem is not CreditMovement movement){MessageBox.Show("Selecione um recebimento na lista de movimentos.");return;}
        var reason=Microsoft.VisualBasic.Interaction.InputBox("Motivo obrigatório do estorno:","Estornar recebimento","");if(string.IsNullOrWhiteSpace(reason))return;
        if(MessageBox.Show($"Estornar o recebimento de {movement.Amount:C}? O saldo do cliente e o caixa serão corrigidos.","Crediário",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
        try{await new AdvancedOperationsService(_db).ReverseCreditReceiptAsync(movement.Id,_operator,reason);await Refresh();MessageBox.Show("Recebimento estornado e saldo recalculado.");}catch(Exception ex){MessageBox.Show(ex.Message,"Crediário",MessageBoxButton.OK,MessageBoxImage.Warning);}
    
        }
        finally{_adminAction046=false;}
    }

    private async void DeleteCredit046_Click(object sender,RoutedEventArgs e)
    {
        if(_adminAction046||_receiving045)return;
        _adminAction046=true;
        try
        {
            if(Accounts.SelectedItem is not CreditView account)
            {
                MessageBox.Show("Selecione uma conta para excluir.","Crediário");return;
            }
            await ArchiveSelected050(new[]{account});
        }
        catch(Exception ex)
        {
            MessageBox.Show("Confira a auditoria antes de tentar novamente.\n\n"+ex.Message,
                "Crediário — atenção",MessageBoxButton.OK,MessageBoxImage.Warning);
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

    private async void WhatsApp_Click(object sender,RoutedEventArgs e)
    {
        if(Accounts.SelectedItem is not CreditView account){MessageBox.Show("Selecione uma conta.");return;}
        var pdf=await _ops.CreditPdfAsync(account,await _ops.CreditMovementsAsync(account.Id));
        var text=Uri.EscapeDataString($"Onça Produtos de Limpeza - Extrato de crediário\nCliente: {account.Customer}\nSaldo: {account.Balance:C}\nArquivo gerado: {pdf}");
        try{System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo($"https://wa.me/?text={text}"){UseShellExecute=true});}catch{System.Windows.Clipboard.SetText($"Extrato: {pdf}");MessageBox.Show("Não foi possível abrir o WhatsApp. O caminho do extrato foi copiado.");}
    }

    private static string StatusLabel(CreditStatus status) => status switch
    {
        CreditStatus.Open => "Em aberto",
        CreditStatus.Partial => "Parcial",
        CreditStatus.Paid => "Pago",
        CreditStatus.Overdue => "Vencido",
        CreditStatus.Cancelled => "Cancelado",
        _ => status.ToString()
    };
}
