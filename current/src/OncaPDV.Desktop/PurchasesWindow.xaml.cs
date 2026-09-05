using System.Collections.ObjectModel;
using System.Windows;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;
public partial class PurchasesWindow:Window
{
 private readonly SupplierService _suppliers;private readonly PurchaseService _purchases;private readonly SqliteProductRepository _products;private readonly ObservableCollection<PurchaseRow> _items=[];
 public PurchasesWindow(OncaDatabase db){InitializeComponent();_suppliers=new(db);_purchases=new(db);_products=new(db);ItemsGrid.ItemsSource=_items;Loaded+=async(_,_)=>await LoadSuppliers();}
 private async Task LoadSuppliers(string term=""){var list=await _suppliers.SearchAsync(term);SupplierGrid.ItemsSource=list;SupplierCombo.ItemsSource=list;if(SupplierCombo.SelectedItem is null&&list.Count>0)SupplierCombo.SelectedIndex=0;}
 private async void SaveSupplier_Click(object sender,RoutedEventArgs e){try{await _suppliers.SaveAsync(new Supplier(Guid.NewGuid(),SupplierName.Text.Trim(),SupplierTax.Text.Trim(),SupplierPhone.Text.Trim(),null));SupplierName.Clear();SupplierTax.Clear();SupplierPhone.Clear();await LoadSuppliers();}catch(Exception ex){MessageBox.Show(ex.Message,"Fornecedor",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void SearchSupplier_Click(object sender,RoutedEventArgs e)=>await LoadSuppliers(SupplierSearch.Text);
 private async void AddItem_Click(object sender,RoutedEventArgs e){try{var product=await _products.FindAsync(ProductSearch.Text.Trim())??throw new DomainException("Produto não encontrado.");if(!decimal.TryParse(Quantity.Text,out var quantity)||quantity<=0||!decimal.TryParse(UnitCost.Text,out var cost)||cost<0)throw new DomainException("Quantidade ou custo inválido.");_items.Add(new(product.Id,product.InternalCode,product.Name,quantity,cost));RefreshTotal();ProductSearch.Clear();UnitCost.Clear();}catch(Exception ex){MessageBox.Show(ex.Message,"Compra",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void CompletePurchase_Click(object sender,RoutedEventArgs e){try{if(SupplierCombo.SelectedItem is not Supplier supplier)throw new DomainException("Selecione o fornecedor.");var purchase=await _purchases.CompleteAsync(supplier.Id,_items.Select(x=>new PurchaseItem(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitCost)).ToArray(),DocumentNumber.Text.Trim());MessageBox.Show($"Compra Nº {purchase.Number:000000} concluída.\nEstoque atualizado: {purchase.Total:C}");_items.Clear();DocumentNumber.Clear();RefreshTotal();}catch(Exception ex){MessageBox.Show(ex.Message,"Compra",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private void RefreshTotal()=>PurchaseTotal.Text=$"TOTAL: {_items.Sum(x=>x.Subtotal):C}";
 private sealed record PurchaseRow(Guid ProductId,string Code,string Name,decimal Quantity,decimal UnitCost){public decimal Subtotal=>Quantity*UnitCost;}
}
