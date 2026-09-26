from pathlib import Path

root=Path('work-final/ONCA-PDV-PRO').resolve()
desktop=root/'src'/'OncaPDV.Desktop'
tests=root/'tests'/'OncaPDV.Tests'

# Narrow UI-only patch: leave multi-sale state, payment, inventory, database, printing and services untouched.
p=desktop/'MainWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
old='Content="✖   CANCELAR VENDA ATUAL" Click="CancelCurrentStable_Click"'
new='Content="✖   DESCARTAR VENDA DA ABA" Click="CancelCurrentStable_Click"'
if old not in x: raise RuntimeError('Current-tab cancel button missing')
x=x.replace(old,new,1)
p.write_text(x,encoding='utf-8')

p=desktop/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
start=c.index('    private async void CancelCurrentStable_Click(')
end=c.index('    private void CompletedSalesStable_Click(',start)
replacement=r'''    private async void CancelCurrentStable_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (_workflow.Cart.Items.Count == 0)
            {
                MessageBox.Show("Esta aba não possui itens para descartar.", "Venda atual", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            var tabNumber = _multiSales037.Count > 0 ? _multiSales037[_currentMultiSale037].Number : 1;
            if (MessageBox.Show($"Descartar somente o carrinho da VENDA {tabNumber}, no valor de {_workflow.Cart.Total:C}?\n\nAs outras abas e vendas já concluídas não serão alteradas.",
                "Confirmar descarte da aba", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            await _workflow.CancelAsync();
            _activeOrderId = null;
            CustomerText.Text = "CONSUMIDOR";
            RefreshCart();
            RecoveryText.Text = string.Empty;
            RefreshMultiSaleTabs037();
            SearchBox.Focus();
            SetStatus($"VENDA {tabNumber} DESCARTADA — OUTRAS ABAS PRESERVADAS");
            MessageBox.Show($"Carrinho da VENDA {tabNumber} descartado. As outras abas foram mantidas.", "Venda atual", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Não foi possível descartar a venda desta aba.\n\n"+ex.Message,
                "Venda atual", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

'''
c=c[:start]+replacement+c[end:]
p.write_text(c,encoding='utf-8')

# Keep original transactional service; make the completed-sale action visible near the search,
# validate the selection and show a separate success message before optional printing.
p=desktop/'SalesManagementWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
needle='<Button Content="PESQUISAR" Click="Search_Click" Background="#0B6B3A" Foreground="White"/>'
if needle not in x: raise RuntimeError('Completed-sale search button missing')
x=x.replace(needle,needle+'<Button Content="CANCELAR VENDA SELECIONADA" Click="Cancel_Click" Background="#B42318" Foreground="White" FontWeight="Bold"/>',1)
p.write_text(x,encoding='utf-8')

p=desktop/'SalesManagementWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
start=c.index(' private async void Cancel_Click(')
end=c.index(' private async void Edit_Click(',start)
replacement=r''' private async void Cancel_Click(object s,RoutedEventArgs e)
 {
  SaleSearchRow row;
  try { row=Selected(); }
  catch(Exception ex) { MessageBox.Show(ex.Message,"Cancelar venda",MessageBoxButton.OK,MessageBoxImage.Warning);return; }
  if(row.Status=="Cancelled"){MessageBox.Show("A venda selecionada já está cancelada.","Cancelar venda",MessageBoxButton.OK,MessageBoxImage.Information);return;}
  if(row.Status!="Completed"){MessageBox.Show("Selecione uma venda concluída para cancelar.","Cancelar venda",MessageBoxButton.OK,MessageBoxImage.Warning);return;}
  var reason=Microsoft.VisualBasic.Interaction.InputBox("Informe o motivo obrigatório do cancelamento:","Cancelar venda realizada","");
  if(string.IsNullOrWhiteSpace(reason))return;
  if(MessageBox.Show($"Cancelar a VENDA {row.Number:000000} de {row.Total:C}?\n\nO caixa, o estoque e o crediário serão estornados conforme os registros da venda. Esta ação ficará registrada.","ONÇA PDV — Confirmar cancelamento",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
  Sale? receiptSale=null;
  try
  {
   receiptSale=await _workflow.GetSaleAsync(row.Id);
   await _advanced.CancelSaleAsync(row.Id,_operator,reason.Trim());
   await Search();
   MessageBox.Show($"VENDA {row.Number:000000} CANCELADA COM SUCESSO.\n\nO motivo ficou registrado no histórico.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Information);
  }
  catch(Exception ex)
  {
   MessageBox.Show("A venda não foi cancelada.\n\n"+ex.Message,"Cancelar venda",MessageBoxButton.OK,MessageBoxImage.Warning);
   return;
  }
  if(receiptSale is not null && MessageBox.Show("Deseja imprimir o comprovante do cancelamento?","ONÇA PDV — Impressão opcional",MessageBoxButton.YesNo,MessageBoxImage.Question)==MessageBoxResult.Yes)
  {
   try
   {
    var result=await _printer.PrintAsync(new(receiptSale,IsReprint:true,SaleLabel:$"CANCELADA {receiptSale.Number:000000}"));
    if(!result.Success)MessageBox.Show("Venda cancelada. O comprovante não foi impresso:\n\n"+(result.Error??"Falha na impressão."),"Impressão",MessageBoxButton.OK,MessageBoxImage.Warning);
   }
   catch(Exception ex){MessageBox.Show("Venda cancelada. O comprovante não foi impresso:\n\n"+ex.Message,"Impressão",MessageBoxButton.OK,MessageBoxImage.Warning);}
  }
 }
'''
c=c[:start]+replacement+c[end:]
p.write_text(c,encoding='utf-8')

# Regression: real SQLite transaction / stock / cash / history / duplicate-cancellation.
(tests/'Cancellation039Tests.cs').write_text(r'''using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class Cancellation039Tests
{
    [Fact]
    public async Task CancelCompletedSale_OnlySelectedSale_AndItsStockCashAndAudit()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-cancel-039-"+Guid.NewGuid().ToString("N"));
        var paths=new AppPaths(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
        try
        {
            var db=new OncaDatabase(paths);db.Migrate();
            var product=Guid.NewGuid();var session=Guid.NewGuid();var op=Guid.NewGuid();
            var first=Guid.NewGuid();var second=Guid.NewGuid();var at=DateTimeOffset.Now.ToString("O");
            await using(var conn=db.Open())
            {
                async Task Exec(string sql)
                {
                    await using var q=conn.CreateCommand();q.CommandText=sql;await q.ExecuteNonQueryAsync();
                }
                await Exec($"INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES('{product}','CANCEL039','Teste',5,15,6,0,'UN',1)");
                await Exec($"INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES('{session}','{op}','{at}',0)");
                await Exec($"INSERT INTO sales(id,number,created_at,operator_id,cash_session_id,discount,total) VALUES('{first}',90001,'{at}','{op}','{session}',0,30)");
                await Exec($"INSERT INTO sales(id,number,created_at,operator_id,cash_session_id,discount,total) VALUES('{second}',90002,'{at}','{op}','{session}',0,30)");
                foreach(var sale in new[]{first,second})
                {
                    await Exec($"INSERT INTO sale_items(id,sale_id,product_id,code,name,quantity,unit_price,subtotal) VALUES('{Guid.NewGuid()}','{sale}','{product}','CANCEL039','Teste',2,15,30)");
                    await Exec($"INSERT INTO payments(id,sale_id,method,amount,change_amount) VALUES('{Guid.NewGuid()}','{sale}','Cash',30,0)");
                    await Exec($"INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at) VALUES('{Guid.NewGuid()}','{session}','Sale',30,'{sale}','Cash','{at}')");
                }
            }
            var service=new AdvancedOperationsService(db);
            await service.CancelSaleAsync(first,op,"Teste de estorno por seleção");

            await using(var conn=db.Open())
            {
                async Task<string> S(string sql)
                {
                    await using var q=conn.CreateCommand();q.CommandText=sql;return Convert.ToString(await q.ExecuteScalarAsync())??"";
                }
                Assert.Equal("Cancelled",await S($"SELECT status FROM sales WHERE id='{first}'"));
                Assert.Equal("Completed",await S($"SELECT status FROM sales WHERE id='{second}'"));
                Assert.Equal(8m,Convert.ToDecimal(await S($"SELECT stock FROM products WHERE id='{product}'")));
                Assert.Equal(30m,Convert.ToDecimal(await S($"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id='{session}'")));
                Assert.Equal("1",await S($"SELECT COUNT(*) FROM sale_events WHERE sale_id='{first}' AND event_type='Cancelled' AND reason='Teste de estorno por seleção'"));
                Assert.Equal("0",await S($"SELECT COUNT(*) FROM sale_events WHERE sale_id='{second}' AND event_type='Cancelled'"));
            }
            await Assert.ThrowsAsync<DomainException>(()=>service.CancelSaleAsync(first,op,"Duplicado"));
        }
        finally
        {
            try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}
        }
    }
}
''',encoding='utf-8')

print('ONCA_CANCEL039_APPLIED=YES')
