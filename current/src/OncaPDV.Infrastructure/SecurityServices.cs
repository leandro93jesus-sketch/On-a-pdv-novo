using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public enum UserRole { Admin, Caixa, Estoque }

public sealed record AppUser(Guid Id, string Username, string DisplayName, UserRole Role, bool Active, bool MustChangePin);

public enum AppPermission
{
    Sell,
    ManageCustomers,
    ReceiveCredit,
    OpenCloseCash,
    ManageProducts,
    AdjustStock,
    ManagePurchases,
    CancelCompletedSale,
    CorrectCompletedSale,
    ChangePrice,
    ChangeDiscount,
    ManageUsers,
    ConfigureBackup,
    ConfigurePrinting
}

public sealed class PermissionService(OncaDatabase db)
{
    public async Task EnsureSeedAsync(CancellationToken ct = default)
    {
        await using var c = db.Open();
        await using var count = c.CreateCommand();
        count.CommandText = "SELECT COUNT(*) FROM app_users";
        if (Convert.ToInt32(await count.ExecuteScalarAsync(ct)) > 0) return;

        var id = Guid.Parse("10000000-0000-0000-0000-000000000001");
        var salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var hash = HashPin("1234", salt);
        await using var q = c.CreateCommand();
        q.CommandText = """
INSERT INTO app_users(id,username,display_name,role,pin_salt,pin_hash,active,must_change_pin,created_at,updated_at)
VALUES($id,'admin','Administrador','Admin',$salt,$hash,1,1,$at,$at)
""";
        q.Parameters.AddWithValue("$id", id.ToString());
        q.Parameters.AddWithValue("$salt", salt);
        q.Parameters.AddWithValue("$hash", hash);
        q.Parameters.AddWithValue("$at", DateTimeOffset.Now.ToString("O"));
        await q.ExecuteNonQueryAsync(ct);
    }

    public async Task<IReadOnlyList<AppUser>> UsersAsync(bool includeInactive = true, CancellationToken ct = default)
    {
        await EnsureSeedAsync(ct);
        var list = new List<AppUser>();
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = "SELECT id,username,display_name,role,active,must_change_pin FROM app_users WHERE $all=1 OR active=1 ORDER BY display_name";
        q.Parameters.AddWithValue("$all", includeInactive ? 1 : 0);
        await using var r = await q.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new(Guid.Parse(r.GetString(0)), r.GetString(1), r.GetString(2), Enum.Parse<UserRole>(r.GetString(3)), r.GetInt32(4) == 1, r.GetInt32(5) == 1));
        return list;
    }

    public async Task<AppUser?> AuthenticateAsync(string username, string pin, CancellationToken ct = default)
    {
        await EnsureSeedAsync(ct);
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = "SELECT id,username,display_name,role,pin_salt,pin_hash,active,must_change_pin FROM app_users WHERE username=$u COLLATE NOCASE LIMIT 1";
        q.Parameters.AddWithValue("$u", username.Trim());
        await using var r = await q.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct) || r.GetInt32(6) != 1) return null;

        var expected = r.GetString(5);
        var actual = HashPin(pin, r.GetString(4));
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(expected), Convert.FromHexString(actual))) return null;

        return new(Guid.Parse(r.GetString(0)), r.GetString(1), r.GetString(2), Enum.Parse<UserRole>(r.GetString(3)), true, r.GetInt32(7) == 1);
    }

    public async Task<bool> ValidateAdminPinAsync(string pin, CancellationToken ct = default)
    {
        await EnsureSeedAsync(ct);
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = "SELECT pin_salt,pin_hash FROM app_users WHERE role='Admin' AND active=1";
        await using var r = await q.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var actual = HashPin(pin, r.GetString(0));
            if (CryptographicOperations.FixedTimeEquals(Convert.FromHexString(r.GetString(1)), Convert.FromHexString(actual))) return true;
        }
        return false;
    }

    public bool Has(AppUser user, AppPermission permission) => user.Role switch
    {
        UserRole.Admin => true,
        UserRole.Caixa => permission is AppPermission.Sell or AppPermission.ManageCustomers or AppPermission.ReceiveCredit or AppPermission.OpenCloseCash,
        UserRole.Estoque => permission is AppPermission.ManageProducts or AppPermission.AdjustStock or AppPermission.ManagePurchases,
        _ => false
    };

    public void Demand(AppUser user, AppPermission permission)
    {
        if (!Has(user, permission))
            throw new DomainException($"Ação não permitida para o perfil {user.Role}. Solicite autorização de administrador.");
    }

    public async Task SaveUserAsync(AppUser user, string? newPin, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(user.Username) || string.IsNullOrWhiteSpace(user.DisplayName))
            throw new DomainException("Informe usuário e nome.");
        if (newPin is not null && (newPin.Length < 4 || !newPin.All(char.IsDigit)))
            throw new DomainException("O PIN deve ter pelo menos 4 números.");

        await EnsureSeedAsync(ct);
        await using var c = db.Open();
        await using var tx = await c.BeginTransactionAsync(ct);

        string salt;
        string hash;
        await using (var existing = c.CreateCommand())
        {
            existing.Transaction = (SqliteTransaction)tx;
            existing.CommandText = "SELECT pin_salt,pin_hash FROM app_users WHERE id=$id";
            existing.Parameters.AddWithValue("$id", user.Id.ToString());
            await using var r = await existing.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                salt = r.GetString(0);
                hash = r.GetString(1);
            }
            else
            {
                salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
                hash = HashPin(newPin ?? "1234", salt);
            }
        }

        if (newPin is not null)
        {
            salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            hash = HashPin(newPin, salt);
        }

        await using var q = c.CreateCommand();
        q.Transaction = (SqliteTransaction)tx;
        q.CommandText = """
INSERT INTO app_users(id,username,display_name,role,pin_salt,pin_hash,active,must_change_pin,created_at,updated_at)
VALUES($id,$u,$name,$role,$salt,$hash,$active,$must,$at,$at)
ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,role=excluded.role,
 pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,active=excluded.active,must_change_pin=excluded.must_change_pin,updated_at=excluded.updated_at
""";
        q.Parameters.AddWithValue("$id", user.Id.ToString());
        q.Parameters.AddWithValue("$u", user.Username.Trim());
        q.Parameters.AddWithValue("$name", user.DisplayName.Trim());
        q.Parameters.AddWithValue("$role", user.Role.ToString());
        q.Parameters.AddWithValue("$salt", salt);
        q.Parameters.AddWithValue("$hash", hash);
        q.Parameters.AddWithValue("$active", user.Active ? 1 : 0);
        q.Parameters.AddWithValue("$must", newPin is null && user.MustChangePin ? 1 : 0);
        q.Parameters.AddWithValue("$at", DateTimeOffset.Now.ToString("O"));
        try
        {
            await q.ExecuteNonQueryAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            await tx.RollbackAsync(ct);
            throw new DomainException("Já existe um usuário com esse nome de acesso.");
        }
    }

    public async Task ChangeOwnPinAsync(Guid userId, string currentPin, string newPin, CancellationToken ct = default)
    {
        if (newPin.Length < 4 || !newPin.All(char.IsDigit)) throw new DomainException("O novo PIN deve ter pelo menos 4 números.");
        await using var c = db.Open();
        await using var q = c.CreateCommand();
        q.CommandText = "SELECT username,pin_salt,pin_hash FROM app_users WHERE id=$id AND active=1";
        q.Parameters.AddWithValue("$id", userId.ToString());
        await using var r = await q.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) throw new DomainException("Usuário não encontrado.");
        var currentHash = HashPin(currentPin, r.GetString(1));
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(r.GetString(2)), Convert.FromHexString(currentHash)))
            throw new DomainException("PIN atual inválido.");
        await r.DisposeAsync();

        var salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var hash = HashPin(newPin, salt);
        await using var update = c.CreateCommand();
        update.CommandText = "UPDATE app_users SET pin_salt=$salt,pin_hash=$hash,must_change_pin=0,updated_at=$at WHERE id=$id";
        update.Parameters.AddWithValue("$salt", salt);
        update.Parameters.AddWithValue("$hash", hash);
        update.Parameters.AddWithValue("$at", DateTimeOffset.Now.ToString("O"));
        update.Parameters.AddWithValue("$id", userId.ToString());
        await update.ExecuteNonQueryAsync(ct);
    }

    private static string HashPin(string pin, string saltHex)
    {
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(pin),
            Convert.FromHexString(saltHex),
            120_000,
            HashAlgorithmName.SHA256,
            32);
        return Convert.ToHexString(hash);
    }
}

public static class AppSession
{
    public static AppUser? CurrentUser { get; set; }
}
