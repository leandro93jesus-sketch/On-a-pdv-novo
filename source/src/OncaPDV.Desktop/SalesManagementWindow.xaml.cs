using System.Windows;using System.Windows.Controls;using OncaPDV.Application;using OncaPDV.Domain;using OncaPDV.Infrastructure;using OncaPDV.Printing;
namespace OncaPDV.Desktop;
public partial class SalesManagementWindow:Window
{
 private readonly OncaDatabase _db;private readonly AdvancedOperationsService _advanced;private readonly PosWorkflow _workflow;private readonly Guid _operator;private readonly IPrintService _printer;private readonly IReceiptRenderer _renderer;private readonly AppPaths _paths=AppPaths.Default();
 public bool CartChanged{get;private set;}
 public SalesManagementWindow(OncaDatabase db,PosWorkflow workflow,Guid op,IPrintService printer,IReceiptRenderer renderer){_db=db;_workflow=workflow;_operator=op;_printer=printer;_renderer=renderer;_advanced=new(db);InitializeComponent();Loaded+=async(_,_)=>await Search();}
 private string Status=>(StatusBox.SelectedItem as ComboBoxItem)?.Content?.ToString()??"Todos";
 private async Task Search(){Grid.ItemsSource=await _advanced.SearchSalesAsync(SearchBox.Text,Status);ReceiptText.Clear();ReceiptTitle.Text="CUPOM DA VENDA";}
 private async void Search_Click(object s,RoutedEventArgs e)=>await Search();
 private SaleSearchRow Selected()=>Grid.SelectedItem as SaleSearchRow??throw new DomainException("Selecione uma venda.");
 private async Task<Sale> Sale()=>await _workflow.GetSaleAsync(Selected().Id)??throw new DomainException("Venda não encontrada.");
 private async void Grid_SelectionChanged(object sender,SelectionChangedEventArgs e){try{if(Grid.SelectedItem is not SaleSearchRow row){ReceiptText.Clear();return;}var sale=await _workflow.GetSaleAsync(row.Id);if(sale is null){ReceiptText.Text="Venda não encontrada.";return;}ReceiptTitle.Text=$"CUPOM • VENDA {sale.Number:000000}";ReceiptText.Text=_renderer.Render(new(sale)).Text;}catch(Exception ex){ReceiptText.Text=ex.Message;}}
 private async void View_Click(object s,RoutedEventArgs e){try{var sale=await Sale();new ReceiptPreviewWindow(_renderer.Render(new(sale)).Text,$"Venda {sale.Number:000000}"){Owner=this}.ShowDialog();}catch(Exception ex){MessageBox.Show(ex.Message,"Cupom",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Reprint_Click(object s,RoutedEventArgs e){try{var sale=await Sale();if(MessageBox.Show($"Deseja reimprimir o cupom da venda {sale.Number:000000}?","ONÇA PDV — Confirmação de impressão",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes)return;var r=await _printer.PrintAsync(new(sale,IsReprint:true));MessageBox.Show(r.Success?"Reimpressão enviada.":r.Error??"Falha na reimpressão.","Reimpressão");}catch(Exception ex){MessageBox.Show(ex.Message,"Reimpressão",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Pdf_Click(object s,RoutedEventArgs e){try{var sale=await Sale();var pdf=await new OperationalService(_db,_paths).SalePdfAsync(sale);MessageBox.Show($"PDF GERADO\n\n{pdf}","Venda",MessageBoxButton.OK,MessageBoxImage.Information);}catch(Exception ex){MessageBox.Show(ex.Message,"PDF",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Cancel_Click(object s,RoutedEventArgs e)
 {
  SaleSearchRow row;
  try { row=Selected(); }
  catch(Exception ex) { MessageBox.Show(ex.Message,"Cancelar venda",MessageBoxButton.OK,MessageBoxImage.Warning);return; }
  if(row.Status=="Cancelled"){MessageBox.Show("A venda selecionada já está cancelada.","Cancelar venda",MessageBoxButton.OK,MessageBoxImage.Information);return;}
  if(row.Status!="Completed"){MessageBox.Show("Selecione uma venda concluída para cancelar.","Cancelar venda",MessageBoxButton.OK,MessageBoxImage.Warning);return;}
  var auth=new AdminAuthorization040Window(_db){Owner=this};
  if(auth.ShowDialog()!=true)return;
  var reasonWindow=new CancellationReason041Window(row.Number){Owner=this};
  if(reasonWindow.ShowDialog()!=true)return;
  var reason=reasonWindow.Reason;
  if(MessageBox.Show($"Cancelar a VENDA {row.Number:000000} de {row.Total:C}?\n\nO caixa, o estoque e o crediário serão estornados conforme os registros da venda. Esta ação ficará registrada.","ONÇA PDV — Confirmar cancelamento",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
  Sale? receiptSale=null;
  try
  {
   receiptSale=await _workflow.GetSaleAsync(row.Id);
   await _advanced.CancelSaleAsync(row.Id,_operator,$"ADMIN: {auth.AuthorizedName} | MOTIVO: {reason.Trim()}");
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
 private async void Delete044_Click(object sender,RoutedEventArgs e)
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
 private async void Edit_Click(object s,RoutedEventArgs e){try{var sale=await Sale();var auth=new AdminAuthorization040Window(_db){Owner=this};if(auth.ShowDialog()!=true)return;var reason=Microsoft.VisualBasic.Interaction.InputBox("Motivo da edição:","Editar venda","");if(string.IsNullOrWhiteSpace(reason))return;if(MessageBox.Show("A venda original será cancelada/estornada e seus itens voltarão ao carrinho para correção. Continuar?","Editar venda",MessageBoxButton.YesNo)!=MessageBoxResult.Yes)return;await _advanced.CancelSaleAsync(sale.Id,_operator,"ADMIN: "+auth.AuthorizedName+" | EDIÇÃO: "+reason);await _workflow.LoadSaleSnapshotAsync(sale);CartChanged=true;DialogResult=true;}catch(Exception ex){MessageBox.Show(ex.Message,"Editar venda",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Payment_Click(object s,RoutedEventArgs e){try{var row=Selected();var dialog=new PaymentMethodChangeWindow{Owner=this};if(dialog.ShowDialog()!=true)return;await _advanced.ChangeSinglePaymentMethodAsync(row.Id,dialog.Method,_operator,dialog.Reason);await Search();MessageBox.Show("Forma de pagamento alterada e caixa/crediário ajustados.");}catch(Exception ex){MessageBox.Show(ex.Message,"Pagamento",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Delivery_Click(object s,RoutedEventArgs e){try{var text=await _advanced.SaleDeliveryTextAsync(Selected().Id);var url="https://wa.me/?text="+Uri.EscapeDataString(text);System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url){UseShellExecute=true});}catch(Exception ex){MessageBox.Show(ex.Message,"WhatsApp",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Fiscal_Click(object s,RoutedEventArgs e){try{var row=Selected();await _advanced.SaveFiscalDraftAsync(row.Id);MessageBox.Show("Rascunho fiscal salvo. Ele poderá ser preparado para emissão depois, sem emitir nota automaticamente.");}catch(Exception ex){MessageBox.Show(ex.Message,"Fiscal",MessageBoxButton.OK,MessageBoxImage.Warning);}}
}