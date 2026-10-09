using System.Windows;
using System.Windows.Controls;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class MainWindow
{
    private WindowStyle _windowStyle030;
    private WindowState _windowState030;
    private bool _editingQuantity030;

    private void ToggleHistory030_Click(object sender, RoutedEventArgs e)
    {
        var show=SalesGrid.Visibility!=Visibility.Visible;
        SalesGrid.Visibility=show?Visibility.Visible:Visibility.Collapsed;
        SalesHistoryRow.Height=new GridLength(show?164:40);
    }

    private async Task RefreshContext030()
    {
        var holds = await new FinalFeaturesService(_database).HoldsAsync();
        HoldCountText.Text = $"RECUPERAR [F7]\n{holds.Count} EM ESPERA";
        using var c = _database.Open();
        using var q = c.CreateCommand();
        q.CommandText = "SELECT id FROM cash_sessions WHERE operator_id=$op AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1";
        q.Parameters.AddWithValue("$op", OperatorId.ToString());
        var id = q.ExecuteScalar() as string;
        SessionText.Text = id is null ? "CAIXA FECHADO • abertura automática ao concluir venda" : $"CAIXA ABERTO • {id[..8]}";
    }

    private void LastSale030_Click(object sender, RoutedEventArgs e) => OpenLastSale();
    private async void SeparateOrder030_Click(object sender, RoutedEventArgs e)
    {
        if (_finalizing040 || _multiSaleSwitching037 || _workflow.Cart.Items.Count == 0) return;
        await SeparateOrderAsync();
    }

    private async void AdjustQuantity030_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string value } && decimal.TryParse(value, out var delta))
            await ChangeSelectedQuantity030(delta);
    }
    private async Task ChangeSelectedQuantity030(decimal delta)
    {
        if (_editingQuantity030 || _finalizing040 || _multiSaleSwitching037) return;
        if (CartGrid.SelectedItem is not CartRow row) { SetStatus("SELECIONE UM ITEM NO CARRINHO"); return; }
        if (row.Quantity + delta <= 0) { SetStatus("USE REMOVER PARA EXCLUIR O ITEM"); return; }
        _editingQuantity030 = true;
        try
        {
            await _workflow.EditCartItemAtAsync(row.Index, quantity: row.Quantity + delta);
            RefreshCart();
            CartGrid.SelectedIndex = row.Index;
            SetStatus("QUANTIDADE ATUALIZADA");
            SearchBox.Focus();
        }
        catch (DomainException ex) { SetStatus(ex.Message); }
        finally { _editingQuantity030 = false; }
    }
    private void EditQuantity030_Click(object sender, RoutedEventArgs e)
    {
        if (CartGrid.SelectedItem is not CartRow row) { SetStatus("SELECIONE UM ITEM NO CARRINHO"); return; }
        CartGrid.Focus();
        CartGrid.CurrentCell = new DataGridCellInfo(row, CartGrid.Columns[2]);
        CartGrid.BeginEdit();
    }
    private async void RemoveSelected030_Click(object sender, RoutedEventArgs e)
    {
        if (_finalizing040 || _multiSaleSwitching037) return;
        if (CartGrid.SelectedItem is not CartRow row) { SetStatus("SELECIONE UM ITEM NO CARRINHO"); return; }
        await _workflow.RemoveCartItemAtAsync(row.Index);
        RefreshCart(); SetStatus("ITEM REMOVIDO"); SearchBox.Focus();
    }
}
