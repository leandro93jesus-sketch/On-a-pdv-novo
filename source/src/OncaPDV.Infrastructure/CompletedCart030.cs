namespace OncaPDV.Infrastructure;

/// <summary>Read-only check of the transaction's durable checkout identity.</summary>
public static class CompletedCart030
{
    public static bool IsCommitted(OncaDatabase db, Guid cartId)
    {
        if (!File.Exists(db.DatabasePath)) return false;
        using var c = db.Open();
        using var exists = c.CreateCommand();
        exists.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='checkout_keys_044'";
        if (Convert.ToInt32(exists.ExecuteScalar()) == 0) return false;
        using var q = c.CreateCommand();
        q.CommandText = "SELECT COUNT(*) FROM checkout_keys_044 WHERE cart_id=$id";
        q.Parameters.AddWithValue("$id", cartId.ToString());
        return Convert.ToInt32(q.ExecuteScalar()) > 0;
    }
}
