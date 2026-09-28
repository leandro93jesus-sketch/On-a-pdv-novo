from pathlib import Path
import re

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'
i=root/'src'/'OncaPDV.Infrastructure'
t=root/'tests'/'OncaPDV.Tests'

def once(text,old,new,label):
    if text.count(old)!=1:raise RuntimeError(f'{label}: expected one match, got {text.count(old)}')
    return text.replace(old,new,1)

# 1. Stable checkout identity: the same cart can never be sold twice, including
# after a crash between SQLite commit and recovery-file deletion.
p=i/'Database.cs';s=p.read_text(encoding='utf-8-sig')
s=once(s,'        MigrateV5(c);','''        MigrateV5(c);
        using(var q=c.CreateCommand()){
            q.CommandText="CREATE TABLE IF NOT EXISTS checkout_keys_044(cart_id TEXT PRIMARY KEY,sale_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,FOREIGN KEY(sale_id) REFERENCES sales(id))";
            q.ExecuteNonQuery();
        }''','additive checkout migration')
needle='''        try
        {
            var number = await ScalarLong(c, tx, "SELECT COALESCE(MAX(number),0)+1 FROM sales", ct);'''
replacement='''        try
        {
            // Check and record the checkout key inside the same transaction as sale,
            // payments, stock and credit movements. No time/amount-based guessing.
            Guid? priorSaleId=null;
            await using(var check=c.CreateCommand())
            {
                check.Transaction=(SqliteTransaction)tx;
                check.CommandText="SELECT k.sale_id,s.status FROM checkout_keys_044 k JOIN sales s ON s.id=k.sale_id WHERE k.cart_id=$cart";
                check.Parameters.AddWithValue("$cart",cart.Id.ToString());
                await using var r=await check.ExecuteReaderAsync(ct);
                if(await r.ReadAsync(ct))
                {
                    if(r.GetString(1)!="Completed")
                        throw new DomainException("Este carrinho pertence a uma venda já estornada. Abra uma nova venda.");
                    priorSaleId=Guid.Parse(r.GetString(0));
                }
            }
            if(priorSaleId is Guid existingId)
            {
                await tx.CommitAsync(ct);
                return await GetAsync(existingId,ct)??throw new DomainException("Venda já registrada, mas não encontrada. Verifique o banco.");
            }
            var number = await ScalarLong(c, tx, "SELECT COALESCE(MAX(number),0)+1 FROM sales", ct);'''
s=once(s,needle,replacement,'checkout key lookup')
s=once(s,'            await tx.CommitAsync(ct); return sale;','''            await Exec(c,tx,"INSERT INTO checkout_keys_044(cart_id,sale_id,created_at) VALUES($cart,$sale,$at)",ct,
                ("$cart",cart.Id),("$sale",sale.Id),("$at",sale.CreatedAt.ToString("O")));
            await tx.CommitAsync(ct); return sale;''','checkout key commit')
s=once(s,'private sealed record Snapshot(Guid? CustomerId,decimal Discount,List<CartItem> Items);',
       'private sealed record Snapshot(Guid? CustomerId,decimal Discount,List<CartItem> Items,Guid? CartId=null);','legacy recovery backwards compatibility')
s=once(s,'new Snapshot(cart.CustomerId,cart.Discount,cart.Items.ToList())',
       'new Snapshot(cart.CustomerId,cart.Discount,cart.Items.ToList(),cart.Id)','persist cart identity')
s=once(s,'var cart=new Cart{CustomerId=s.CustomerId};foreach(var i in s.Items)',
       'var cart=new Cart{Id=s.CartId is Guid saved && saved!=Guid.Empty?saved:Guid.NewGuid(),CustomerId=s.CustomerId};foreach(var i in s.Items)',
       'restore cart identity')
p.write_text(s,encoding='utf-8')

# 2. Multi-sale switching and tab recovery must not fabricate a fresh cart Id.
p=d/'MainWindow.xaml.cs';s=p.read_text(encoding='utf-8-sig')
s=once(s,'var copy = new Cart { CustomerId = source.CustomerId };',
       'var copy = new Cart { Id = source.Id, CustomerId = source.CustomerId };','clone cart identity')
s=once(s,'s.Cart.Items.Select(item=>new CartItem040(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice)).ToList()',
       's.Cart.Items.Select(item=>new CartItem040(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice)).ToList(),s.Cart.Id','snapshot identity')
s=once(s,'var cart=new Cart{CustomerId=saved.CustomerId};',
       'var cart=new Cart{Id=saved.CartId is Guid savedId && savedId!=Guid.Empty?savedId:Guid.NewGuid(),CustomerId=saved.CustomerId};',
       'restore identity')
# Prevent a scanner search/add callback from racing with tab switching.
s=once(s,'    private async Task AddProduct()\n    {','''    private bool _adding044;
    private async Task AddProduct()
    {
        if(_adding044||_multiSaleSwitching037||_finalizing040)return;
        _adding044=true;
        try
        {''','scanner entry')
s=once(s,'        SearchBox.Clear();\n        SearchBox.Focus();\n    }\n\n    private async Task OpenProduct',
       '        SearchBox.Clear();\n        SearchBox.Focus();\n        }\n        finally{_adding044=false;}\n    }\n\n    private async Task OpenProduct','scanner finally')
s=once(s,'if (index < 0 || index >= _multiSales037.Count || index == _currentMultiSale037) return;',
       'if (_adding044||_finalizing040||index < 0 || index >= _multiSales037.Count || index == _currentMultiSale037) return;',
       'tab selection in-progress scan guard')
s=once(s,'    private async void NewMultiSale_Click(object sender, RoutedEventArgs e)\n    {',
       '    private async void NewMultiSale_Click(object sender, RoutedEventArgs e)\n    {\n        if(_adding044||_finalizing040||_multiSaleSwitching037)return;',
       'new tab in-progress guard')
s=once(s,'    private async void CloseMultiSale_Click(object sender, RoutedEventArgs e)\n    {',
       '    private async void CloseMultiSale_Click(object sender, RoutedEventArgs e)\n    {\n        if(_adding044||_finalizing040||_multiSaleSwitching037)return;',
       'close tab in-progress guard')
p.write_text(s,encoding='utf-8')

p=i/'MultiSaleRecovery040.cs';s=p.read_text(encoding='utf-8-sig')
s=once(s,'public sealed record SaleTab040(int Number,string Label,string CustomerLabel,Guid? CustomerId,Guid? OrderId,decimal Discount,List<CartItem040> Items);',
       'public sealed record SaleTab040(int Number,string Label,string CustomerLabel,Guid? CustomerId,Guid? OrderId,decimal Discount,List<CartItem040> Items,Guid? CartId=null);',
       'add optional old-snapshot-compatible cart identity')
p.write_text(s,encoding='utf-8')

# 3. Soft deletion: single atomic sale reversal and audit event.
p=i/'AdvancedOperations.cs';s=p.read_text(encoding='utf-8-sig')
old='''    public async Task CancelSaleAsync(Guid saleId,Guid operatorId,string reason,CancellationToken ct=default)
    {'''
new='''    public Task CancelSaleAsync(Guid saleId,Guid operatorId,string reason,CancellationToken ct=default)
        =>ReverseSaleAsync(saleId,operatorId,reason,"Cancelled",ct);
    public Task DeleteSaleAsync(Guid saleId,Guid operatorId,string reason,CancellationToken ct=default)
        =>ReverseSaleAsync(saleId,operatorId,reason,"Deleted",ct);

    private async Task ReverseSaleAsync(Guid saleId,Guid operatorId,string reason,string targetStatus,CancellationToken ct)
    {'''
s=once(s,old,new,'shared transactional reverse')
s=once(s,'if(status=="Cancelled")throw new DomainException("Esta venda já está cancelada.");',
'''if(status=="Deleted")throw new DomainException("Esta venda já foi excluída.");
        if(status=="Cancelled" && targetStatus=="Deleted")
        {
            if(await Exec(c,tx,"UPDATE sales SET status='Deleted' WHERE id=$id AND status='Cancelled'",ct,("$id",saleId))!=1)
                throw new DomainException("Venda alterada por outro terminal.");
            await AddEvent(c,tx,saleId,operatorId,"Deleted",reason,"Exclusão de venda já cancelada: sem novo estorno.",ct);
            await tx.CommitAsync(ct);
            return;
        }
        if(status!="Completed")throw new DomainException("Somente uma venda concluída pode ser estornada.");
        if(targetStatus=="Deleted")
        {
            var fiscal=await ScalarText(c,tx,"SELECT fiscal_status FROM sales WHERE id=$id",("$id",saleId),ct);
            if(fiscal is "Authorized" or "Pending")throw new DomainException("Venda com documento fiscal autorizado ou pendente: resolva a situação fiscal antes de excluir.");
        }''','single-state reverse guard')
s=once(s,'q.CommandText="SELECT session_id,type,amount,reason FROM cash_movements WHERE origin_id=$sale AND amount>0";',
       'q.CommandText="SELECT session_id,type,SUM(amount),\'ESTORNO SALDO LÍQUIDO\' FROM cash_movements WHERE origin_id=$sale AND type=\'Sale\' GROUP BY session_id,type HAVING SUM(amount)<>0";',
       'reverse net cash, not already reversed historical positive entries')
s=once(s,'''        await Exec(c,tx,"UPDATE sales SET status='Cancelled',fiscal_status=CASE WHEN fiscal_status='Authorized' THEN 'Cancelled' ELSE fiscal_status END WHERE id=$id",ct,("$id",saleId));
        await AddEvent(c,tx,saleId,operatorId,"Cancelled",reason,null,ct);await tx.CommitAsync(ct);''',
'''        if(await Exec(c,tx,"UPDATE sales SET status=$status,fiscal_status=CASE WHEN fiscal_status='Authorized' THEN 'Cancelled' ELSE fiscal_status END WHERE id=$id AND status='Completed'",ct,
            ("$status",targetStatus),("$id",saleId))!=1)throw new DomainException("Venda alterada por outro terminal.");
        await AddEvent(c,tx,saleId,operatorId,targetStatus,reason,null,ct);await tx.CommitAsync(ct);''',
       'atomic final reversal status and audit')
# Default view excludes hidden records; explicit filter still allows audit.
s=once(s,"WHERE ($status='Todos' OR s.status=$status) AND (",
       "WHERE (($status='Todos' AND s.status<>'Deleted') OR ($status='Excluídas' AND s.status='Deleted') OR ($status='Todas inclusive excluídas') OR s.status=$status) AND (",
       'separate hidden sales views')
p.write_text(s,encoding='utf-8')

# 4. Delete action stays separate from cancellation and requires an admin PIN and reason.
p=d/'SalesManagementWindow.xaml';s=p.read_text(encoding='utf-8-sig')
s=once(s,'<ComboBoxItem Content="Cancelled"/></ComboBox>',
       '<ComboBoxItem Content="Cancelled"/><ComboBoxItem Content="Excluídas"/><ComboBoxItem Content="Todas inclusive excluídas"/></ComboBox>',
       'deleted sales filter')
s=once(s,'<Button Content="CANCELAR VENDA SELECIONADA" Click="Cancel_Click" Background="#B42318" Foreground="White" FontWeight="Bold"/>',
       '<Button Content="CANCELAR VENDA SELECIONADA" Click="Cancel_Click" Background="#B42318" Foreground="White" FontWeight="Bold"/><Button Content="EXCLUIR VENDA" Click="Delete044_Click" Background="#892A20" Foreground="White" FontWeight="Bold"/>',
       'visible delete button')
s=once(s,'<Button Content="CANCELAR VENDA REALIZADA" Click="Cancel_Click" Foreground="#B42318"/>',
       '<Button Content="🗑 CANCELAR VENDA FINALIZADA" Click="Cancel_Click" Foreground="#B42318"/><Button Content="EXCLUIR VENDA" Click="Delete044_Click" Foreground="#892A20"/>',
       'bottom delete button')
p.write_text(s,encoding='utf-8')

p=d/'SalesManagementWindow.xaml.cs';s=p.read_text(encoding='utf-8-sig')
anchor=' private async void Edit_Click('
delete=r''' private async void Delete044_Click(object sender,RoutedEventArgs e)
 {
  SaleSearchRow row;
  try{row=Selected();}
  catch(Exception ex){MessageBox.Show(ex.Message,"Excluir venda",MessageBoxButton.OK,MessageBoxImage.Warning);return;}
  if(row.Status=="Deleted"){MessageBox.Show("Esta venda já foi excluída.","ONÇA PDV");return;}
  if(row.Status!="Completed" && row.Status!="Cancelled"){MessageBox.Show("Selecione uma venda concluída ou cancelada.","ONÇA PDV");return;}
  var auth=new AdminAuthorization040Window(_db){Owner=this};
  if(auth.ShowDialog()!=true)return;
  var reasonWindow=new CancellationReason041Window(row.Number){Owner=this,Title="Motivo da exclusão — ONÇA PDV"};
  if(reasonWindow.ShowDialog()!=true)return;
  if(MessageBox.Show($"EXCLUIR A VENDA {row.Number:000000} DE {row.Total:C}?\n\nEla sairá da lista normal, mas será mantida na auditoria. Se ainda estiver concluída, o estorno de caixa, estoque e crediário ocorrerá uma única vez.\n\nEsta operação não pode ser desfeita pela tela.",
     "CONFIRMAR EXCLUSÃO DA VENDA",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
  try
  {
   await _advanced.DeleteSaleAsync(row.Id,_operator,$"ADMIN: {auth.AuthorizedName} | EXCLUSÃO: {reasonWindow.Reason}");
   await Search();
   MessageBox.Show($"Venda {row.Number:000000} excluída da listagem normal. Auditoria preservada.\n\nUse o filtro Excluídas para consultar.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Information);
  }
  catch(Exception ex){MessageBox.Show("A venda não foi excluída.\n\n"+ex.Message,"ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Warning);}
 }
'''
s=once(s,anchor,delete+anchor,'separate admin delete handler')
p.write_text(s,encoding='utf-8')

(t/'SalesIntegrity044Tests.cs').write_text(Path('scripts/feature044_tests.cs').read_text(encoding='utf-8'),encoding='utf-8')
print('ONCA_SALES_INTEGRITY_044_APPLIED=YES')
