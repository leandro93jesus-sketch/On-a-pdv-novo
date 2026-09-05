using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace OncaPDV.Desktop;

public partial class BarcodeLabelWindow : Window
{
    private static readonly string[] L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
    private static readonly string[] G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
    private static readonly string[] R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
    private static readonly string[] Parity = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

    private readonly string _ean;

    public BarcodeLabelWindow(string productName, string barcode, decimal price)
    {
        InitializeComponent();
        NameText.Text = productName;
        PriceText.Text = price.ToString("C");
        _ean = Normalize(barcode);
        BarcodeText.Text = _ean;
        Loaded += (_, _) => Draw();
    }

    private static string Normalize(string raw)
    {
        var digits = string.Concat(raw.Where(char.IsDigit));
        if (digits.Length == 12) digits += CheckDigit(digits);
        if (digits.Length != 13) throw new InvalidOperationException("A etiqueta EAN-13 exige código de barras com 12 ou 13 dígitos.");
        var expected = CheckDigit(digits[..12]);
        if (digits[12] != expected) throw new InvalidOperationException("Dígito verificador EAN-13 inválido.");
        return digits;
    }

    private static char CheckDigit(string twelve)
    {
        var sum = 0;
        for (var i = 0; i < twelve.Length; i++)
        {
            var d = twelve[i] - '0';
            sum += i % 2 == 0 ? d : d * 3;
        }
        return (char)('0' + ((10 - (sum % 10)) % 10));
    }

    private void Draw()
    {
        var first = _ean[0] - '0';
        var bits = "101";
        for (var i = 1; i <= 6; i++)
        {
            var digit = _ean[i] - '0';
            bits += Parity[first][i - 1] == 'L' ? L[digit] : G[digit];
        }
        bits += "01010";
        for (var i = 7; i <= 12; i++) bits += R[_ean[i] - '0'];
        bits += "101";

        BarcodeCanvas.Children.Clear();
        var module = BarcodeCanvas.Width / bits.Length;
        for (var i = 0; i < bits.Length; i++)
        {
            if (bits[i] != '1') continue;
            var guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
            var rect = new Rectangle
            {
                Width = Math.Ceiling(module + 0.15),
                Height = guard ? 130 : 116,
                Fill = Brushes.Black
            };
            Canvas.SetLeft(rect, i * module);
            Canvas.SetTop(rect, 4);
            BarcodeCanvas.Children.Add(rect);
        }
    }

    private void Print_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new PrintDialog();
        if (dialog.ShowDialog() != true) return;
        dialog.PrintVisual(PrintArea, $"Etiqueta {_ean}");
    }
}
