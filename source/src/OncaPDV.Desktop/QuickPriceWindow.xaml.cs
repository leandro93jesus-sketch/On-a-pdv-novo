using System;using System.IO;using System.Windows;using System.Windows.Media.Imaging;using OncaPDV.Domain;
namespace OncaPDV.Desktop;
public partial class QuickPriceWindow:Window
{
 public QuickPriceWindow(Product p)
 {
  InitializeComponent();NameText.Text=p.Name;CodeText.Text=$"Código: {p.InternalCode}   •   Barras: {p.Barcode ?? "—"}";PriceText.Text=p.CurrentPrice(DateTimeOffset.Now).ToString("C");StockText.Text=$"Estoque: {p.Stock:N3} {p.Unit}";
  var now=DateTimeOffset.Now;var promo=p.PromotionalPrice is not null&&p.PromotionStartsAt<=now&&p.PromotionEndsAt>=now;
  PromoText.Text=promo?$"PROMOÇÃO ATIVA • preço normal {p.SalePrice:C} • até {p.PromotionEndsAt:dd/MM/yyyy}":"Sem promoção ativa no momento.";
  TryPhoto(p.PhotoPath);
 }
 private void TryPhoto(string? path){try{if(!string.IsNullOrWhiteSpace(path)&&File.Exists(path)){Photo.Source=new BitmapImage(new Uri(Path.GetFullPath(path)));NoPhoto.Visibility=Visibility.Collapsed;}}catch{}}
 private void Add_Click(object sender,RoutedEventArgs e)=>DialogResult=true;
 private void Close_Click(object sender,RoutedEventArgs e)=>DialogResult=false;
}