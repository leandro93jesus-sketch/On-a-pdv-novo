using System.Globalization;
using System.Windows;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using OncaPDV.Domain;

namespace OncaPDV.Desktop;

public partial class ProductWindow:Window
{
    private readonly Product? _existing;
    private string? _photoPath;
    public Product? Product{get;private set;}
    public string? ShelfLocation=>Null(Shelf.Text);

    public ProductWindow(string? barcode=null,Product? existing=null,string? shelfLocation=null)
    {
        _existing=existing;InitializeComponent();Shelf.Text=shelfLocation??string.Empty;
        if(existing is null){Barcode.Text=barcode??"";if(barcode is not null)Code.Text=barcode;return;}
        Code.Text=existing.InternalCode;Barcode.Text=existing.Barcode??"";ProductName.Text=existing.Name;Description.Text=existing.Description??"";Category.Text=existing.Category??"";Brand.Text=existing.Brand??"";Unit.Text=existing.Unit;Stock.Text=existing.Stock.ToString("N3");Stock.IsReadOnly=true;MinimumStock.Text=existing.MinimumStock.ToString("N3");Cost.Text=existing.CostPrice.ToString("N2");Price.Text=existing.SalePrice.ToString("N2");Supplier.Text=existing.Supplier??"";Active.IsChecked=existing.Active;PromotionalPrice.Text=existing.PromotionalPrice?.ToString("N2")??"";PromotionStart.SelectedDate=existing.PromotionStartsAt?.LocalDateTime.Date;PromotionEnd.SelectedDate=existing.PromotionEndsAt?.LocalDateTime.Date;_photoPath=existing.PhotoPath;LoadPhoto();Title="Editar produto — estoque protegido";UpdateMargin();
    }

    private void Save_Click(object sender,RoutedEventArgs e)
    {
        if(string.IsNullOrWhiteSpace(Code.Text)||string.IsNullOrWhiteSpace(ProductName.Text)||string.IsNullOrWhiteSpace(Unit.Text)){MessageBox.Show("Informe código, nome e unidade.","Produto",MessageBoxButton.OK,MessageBoxImage.Warning);return;}
        if(!TryMoney(Cost.Text,out var cost)||!TryMoney(Price.Text,out var price)||!TryNumber(Stock.Text,out var stock)||!TryNumber(MinimumStock.Text,out var min)){MessageBox.Show("Custo, preço ou estoque inválido.");return;}
        decimal? promo=null;if(!string.IsNullOrWhiteSpace(PromotionalPrice.Text)){if(!TryMoney(PromotionalPrice.Text,out var pv)){MessageBox.Show("Preço promocional inválido.");return;}promo=pv;}
        DateTimeOffset? start=PromotionStart.SelectedDate is DateTime sd?new DateTimeOffset(sd):null;DateTimeOffset? end=PromotionEnd.SelectedDate is DateTime ed?new DateTimeOffset(ed.Date.AddDays(1).AddTicks(-1)):null;if(promo is not null&&(start is null||end is null||end<start)){MessageBox.Show("Informe início e fim válidos para a promoção.");return;}
        Product=new(_existing?.Id??Guid.NewGuid(),Code.Text.Trim(),Null(Barcode.Text),ProductName.Text.Trim(),Null(Description.Text),Null(Category.Text),Null(Brand.Text),cost,price,_existing?.Stock??stock,min,Unit.Text.Trim(),Null(Supplier.Text),_photoPath,Active.IsChecked==true,promo,start,end);DialogResult=true;
    }

    private void Photo_Click(object sender,RoutedEventArgs e)
    {
        var d=new OpenFileDialog{Filter="Imagens|*.png;*.jpg;*.jpeg;*.bmp"};if(d.ShowDialog()!=true)return;_photoPath=d.FileName;LoadPhoto();
    }
    private void RemovePhoto_Click(object sender,RoutedEventArgs e){_photoPath=null;ProductImage.Source=null;PhotoPathText.Text="Nenhuma foto selecionada";}
    private void LoadPhoto(){if(string.IsNullOrWhiteSpace(_photoPath)||!File.Exists(_photoPath)){PhotoPathText.Text="Nenhuma foto selecionada";return;}try{ProductImage.Source=new BitmapImage(new Uri(_photoPath));PhotoPathText.Text=_photoPath;}catch{ProductImage.Source=null;PhotoPathText.Text="Não foi possível visualizar a foto.";}}
    private void Price_TextChanged(object sender,System.Windows.Controls.TextChangedEventArgs e)=>UpdateMargin();
    private void UpdateMargin(){if(MarginText is null)return;if(TryMoney(Cost?.Text??"",out var cost)&&TryMoney(Price?.Text??"",out var price)&&cost>0)MarginText.Text=$"{((price-cost)/cost)*100:N1}%";else MarginText.Text="0,0%";}
    private static bool TryMoney(string value,out decimal result)=>decimal.TryParse(value,NumberStyles.Number,CultureInfo.CurrentCulture,out result)||decimal.TryParse(value.Replace('.',','),NumberStyles.Number,CultureInfo.GetCultureInfo("pt-BR"),out result);
    private static bool TryNumber(string value,out decimal result)=>TryMoney(value,out result);
    private static string? Null(string value)=>string.IsNullOrWhiteSpace(value)?null:value.Trim();
}
