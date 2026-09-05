using Microsoft.Data.Sqlite;

namespace OncaPDV.Infrastructure;

public sealed record ProductExtraProfile(Guid ProductId, string? Location, string? PreferredSupplier, string? LabelNotes);

public sealed class ProductMetadataStore(OncaDatabase db)
{
    public async Task<ProductExtraProfile> LoadAsync(Guid productId, CancellationToken ct = default)
    {
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = "SELECT location,preferred_supplier,label_notes FROM product_metadata WHERE product_id=$id";
        q.Parameters.AddWithValue("$id", productId.ToString());
        await using var r = await q.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return new(productId, null, null, null);
        return new(productId,
            r.IsDBNull(0) ? null : r.GetString(0),
            r.IsDBNull(1) ? null : r.GetString(1),
            r.IsDBNull(2) ? null : r.GetString(2));
    }

    public async Task SaveAsync(ProductExtraProfile profile, CancellationToken ct = default)
    {
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = """
INSERT INTO product_metadata(product_id,location,preferred_supplier,label_notes,updated_at)
VALUES($id,$location,$supplier,$notes,$at)
ON CONFLICT(product_id) DO UPDATE SET location=excluded.location,preferred_supplier=excluded.preferred_supplier,label_notes=excluded.label_notes,updated_at=excluded.updated_at
""";
        q.Parameters.AddWithValue("$id", profile.ProductId.ToString());
        q.Parameters.AddWithValue("$location", (object?)Clean(profile.Location) ?? DBNull.Value);
        q.Parameters.AddWithValue("$supplier", (object?)Clean(profile.PreferredSupplier) ?? DBNull.Value);
        q.Parameters.AddWithValue("$notes", (object?)Clean(profile.LabelNotes) ?? DBNull.Value);
        q.Parameters.AddWithValue("$at", DateTimeOffset.Now.ToString("O"));
        await q.ExecuteNonQueryAsync(ct);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
