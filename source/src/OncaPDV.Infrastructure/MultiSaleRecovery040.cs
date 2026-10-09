using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace OncaPDV.Infrastructure;

public sealed record CartItem040(Guid ProductId,string Code,string Name,decimal Quantity,decimal UnitPrice);
public sealed record SaleTab040(int Number,string Label,string CustomerLabel,Guid? CustomerId,Guid? OrderId,decimal Discount,List<CartItem040> Items,Guid? CartId=null);
public sealed record SaleTabsSnapshot040(int ActiveNumber,int NextNumber,List<SaleTab040> Tabs);

/// <summary>Separate, atomic recovery state: never alters existing sales, products or legacy cart recovery.</summary>
public sealed class MultiSaleRecovery040
{
    private readonly OncaDatabase _db;
    private readonly string _terminal;
    public MultiSaleRecovery040(OncaDatabase db,string? terminal=null)
    {
        _db=db;
        _terminal=terminal??(Environment.MachineName+"/"+Environment.UserName);
        if(string.IsNullOrWhiteSpace(_terminal))throw new ArgumentException("Terminal obrigatório.",nameof(terminal));
        using var c=_db.Open();
        using var q=c.CreateCommand();
        q.CommandText="CREATE TABLE IF NOT EXISTS multivendas_recovery_040(terminal_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at TEXT NOT NULL);";
        q.ExecuteNonQuery();
    }

    public SaleTabsSnapshot040? Load()
    {
        using var c=_db.Open();using var q=c.CreateCommand();
        q.CommandText="SELECT snapshot_json FROM multivendas_recovery_040 WHERE terminal_id=$t";
        q.Parameters.AddWithValue("$t",_terminal);
        var json=q.ExecuteScalar() as string;
        if(json is null)return null;
        var state=JsonSerializer.Deserialize<SaleTabsSnapshot040>(json)??throw new InvalidDataException("Recuperação de abas vazia.");
        Validate(state);
        return state with { Tabs = state.Tabs.Select(t => t.CartId is Guid id && CompletedCart030.IsCommitted(_db, id)
            ? t with { Items = [], Discount = 0, CustomerId = null, CustomerLabel = "CONSUMIDOR", OrderId = null, CartId = Guid.NewGuid() }
            : t).ToList() };
    }
    public void Save(SaleTabsSnapshot040 state)
    {
        Validate(state);
        var json=JsonSerializer.Serialize(state);
        using var c=_db.Open();using var tx=c.BeginTransaction();
        using var q=c.CreateCommand();q.Transaction=tx;
        q.CommandText=@"INSERT INTO multivendas_recovery_040(terminal_id,snapshot_json,updated_at) VALUES($t,$j,$at)
ON CONFLICT(terminal_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at";
        q.Parameters.AddWithValue("$t",_terminal);q.Parameters.AddWithValue("$j",json);
        q.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
        if(q.ExecuteNonQuery()!=1)throw new IOException("Não foi possível salvar as vendas abertas.");
        tx.Commit();
    }
    private static void Validate(SaleTabsSnapshot040 s)
    {
        if(s.Tabs is null||s.Tabs.Count<1||s.Tabs.Count>50)throw new InvalidDataException("Quantidade inválida de abas recuperadas.");
        if(s.Tabs.Any(t=>t.Number<1||t.Number>=s.NextNumber||t.Items is null||t.Items.Count>2000||t.Discount<0||
             t.Items.Any(i=>i.Quantity<=0||i.UnitPrice<0||string.IsNullOrWhiteSpace(i.Code)||string.IsNullOrWhiteSpace(i.Name))))
            throw new InvalidDataException("Dados inválidos em uma aba recuperada.");
        if(s.Tabs.Select(t=>t.Number).Distinct().Count()!=s.Tabs.Count||!s.Tabs.Any(t=>t.Number==s.ActiveNumber))
            throw new InvalidDataException("Identificadores de abas inválidos.");
    }
}

/// <summary>Owner-configured salted admin PIN. No default credentials or plaintext PIN are stored.</summary>
public sealed class AdminPinService040
{
    private readonly OncaDatabase _db;
    private const int Iterations=210000;
    public AdminPinService040(OncaDatabase db)
    {
        _db=db;using var c=db.Open();using var q=c.CreateCommand();
        q.CommandText=@"CREATE TABLE IF NOT EXISTS administrator_pin_040(
id INTEGER PRIMARY KEY CHECK(id=1), administrator TEXT NOT NULL,salt BLOB NOT NULL, hash BLOB NOT NULL,
iterations INTEGER NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
created_at TEXT NOT NULL);";
        q.ExecuteNonQuery();
    }
    public bool IsConfigured
    {
        get{using var c=_db.Open();using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM administrator_pin_040 WHERE id=1";return Convert.ToInt32(q.ExecuteScalar())==1;}
    }
    public string AdministratorName
    {
        get{using var c=_db.Open();using var q=c.CreateCommand();q.CommandText="SELECT administrator FROM administrator_pin_040 WHERE id=1";return Convert.ToString(q.ExecuteScalar())??"";}
    }
    public void Configure(string name,string pin,string confirmation)
    {
        name=(name??"").Trim();
        if(name.Length<2||name.Length>80)throw new ArgumentException("Informe o nome do administrador.");
        ValidatePin(pin);
        if(!string.Equals(pin,confirmation,StringComparison.Ordinal))throw new ArgumentException("Confirmação do PIN diferente.");
        var salt=RandomNumberGenerator.GetBytes(24);
        var hash=Rfc2898DeriveBytes.Pbkdf2(pin,salt,Iterations,HashAlgorithmName.SHA256,32);
        using var c=_db.Open();using var tx=c.BeginTransaction();using var q=c.CreateCommand();q.Transaction=tx;
        q.CommandText=@"INSERT OR IGNORE INTO administrator_pin_040(id,administrator,salt,hash,iterations,created_at)
VALUES(1,$name,$salt,$hash,$iterations,$at)";
        q.Parameters.AddWithValue("$name",name);q.Parameters.AddWithValue("$salt",salt);q.Parameters.AddWithValue("$hash",hash);
        q.Parameters.AddWithValue("$iterations",Iterations);q.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
        if(q.ExecuteNonQuery()!=1)throw new InvalidOperationException("O PIN do administrador já foi configurado.");
        tx.Commit();
    }
    public bool Verify(string pin)
    {
        using var c=_db.Open();using var tx=c.BeginTransaction();
        string name="";byte[] salt=Array.Empty<byte>(),hash=Array.Empty<byte>();int iterations=0,attempts=0;
        DateTimeOffset? locked=null;
        using(var q=c.CreateCommand())
        {
            q.Transaction=tx;q.CommandText="SELECT administrator,salt,hash,iterations,failed_attempts,locked_until FROM administrator_pin_040 WHERE id=1";
            using var r=q.ExecuteReader();
            if(!r.Read())throw new InvalidOperationException("Configure o PIN do administrador primeiro.");
            name=r.GetString(0);salt=r.GetFieldValue<byte[]>(1);hash=r.GetFieldValue<byte[]>(2);
            iterations=r.GetInt32(3);attempts=r.GetInt32(4);locked=r.IsDBNull(5)?null:DateTimeOffset.Parse(r.GetString(5));
        }
        if(string.IsNullOrWhiteSpace(name))throw new InvalidOperationException("Administrador não configurado.");
        if(locked>DateTimeOffset.UtcNow)throw new InvalidOperationException("Acesso temporariamente bloqueado após tentativas incorretas. Tente novamente depois.");
        var test=Rfc2898DeriveBytes.Pbkdf2(pin??"",salt,iterations,HashAlgorithmName.SHA256,32);
        var ok=CryptographicOperations.FixedTimeEquals(test,hash);
        using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=ok?"UPDATE administrator_pin_040 SET failed_attempts=0,locked_until=NULL WHERE id=1":
                "UPDATE administrator_pin_040 SET failed_attempts=$n,locked_until=$until WHERE id=1";
            if(!ok)
            {
                attempts++;
                q.Parameters.AddWithValue("$n",attempts>=5?0:attempts);
                q.Parameters.AddWithValue("$until",attempts>=5?DateTimeOffset.UtcNow.AddMinutes(5).ToString("O"):(object)DBNull.Value);
            }
            q.ExecuteNonQuery();
        }
        tx.Commit();
        return ok;
    }

    /// <summary>One-time owner-controlled PIN rotation during upgrade 0.1.42.
    /// Atomic, never changes sales/products/carts/stock; does not override later user changes.</summary>
    public bool NeedsOwnerPinSetup042
    {
        get
        {
            using var c=_db.Open();using var q=c.CreateCommand();
            q.CommandText="CREATE TABLE IF NOT EXISTS admin_pin_setup_042(id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT NOT NULL)";
            q.ExecuteNonQuery();
            q.CommandText="SELECT COUNT(*) FROM admin_pin_setup_042 WHERE id=1";
            return Convert.ToInt32(q.ExecuteScalar())==0;
        }
    }

    public void ConfigureOwnerPinOnce042(string administrator,string pin,string confirmation)
    {
        administrator=(administrator??"").Trim();
        if(administrator.Length<2||administrator.Length>80)throw new ArgumentException("Informe um nome de administrador válido.");
        ValidatePin(pin);
        if(!string.Equals(pin,confirmation,StringComparison.Ordinal))throw new ArgumentException("A confirmação do PIN não confere.");
        var salt=RandomNumberGenerator.GetBytes(24);
        var hash=Rfc2898DeriveBytes.Pbkdf2(pin,salt,Iterations,HashAlgorithmName.SHA256,32);
        using var c=_db.Open();using var tx=c.BeginTransaction();
        using(var create=c.CreateCommand())
        {
            create.Transaction=tx;
            create.CommandText="CREATE TABLE IF NOT EXISTS admin_pin_setup_042(id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT NOT NULL)";
            create.ExecuteNonQuery();
        }
        using(var check=c.CreateCommand())
        {
            check.Transaction=tx;
            check.CommandText="SELECT COUNT(*) FROM admin_pin_setup_042 WHERE id=1";
            if(Convert.ToInt32(check.ExecuteScalar())>0)throw new InvalidOperationException("Esta configuração inicial já foi concluída.");
        }
        using(var update=c.CreateCommand())
        {
            update.Transaction=tx;
            update.CommandText=@"INSERT INTO administrator_pin_040(id,administrator,salt,hash,iterations,failed_attempts,locked_until,created_at)
VALUES(1,$administrator,$salt,$hash,$iterations,0,NULL,$at)
ON CONFLICT(id) DO UPDATE SET administrator=excluded.administrator,salt=excluded.salt,hash=excluded.hash,
iterations=excluded.iterations,failed_attempts=0,locked_until=NULL";
            update.Parameters.AddWithValue("$administrator",administrator);
            update.Parameters.AddWithValue("$salt",salt);
            update.Parameters.AddWithValue("$hash",hash);
            update.Parameters.AddWithValue("$iterations",Iterations);
            update.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
            if(update.ExecuteNonQuery()!=1)throw new IOException("Não foi possível atualizar o PIN.");
        }
        using(var marker=c.CreateCommand())
        {
            marker.Transaction=tx;
            marker.CommandText="INSERT INTO admin_pin_setup_042(id,completed_at) VALUES(1,$at)";
            marker.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
            if(marker.ExecuteNonQuery()!=1)throw new IOException("Não foi possível confirmar a troca do PIN.");
        }
        tx.Commit();
    }


    // One-time owner-initiated recovery for an older setup screen that was already
    // marked complete. No secret is embedded; the owner enters and confirms it.
    public bool NeedsOwnerRecovery043
    {
        get
        {
            using var c=_db.Open();using var q=c.CreateCommand();
            q.CommandText="CREATE TABLE IF NOT EXISTS admin_recovery_043(id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT NOT NULL)";
            q.ExecuteNonQuery();
            q.CommandText="SELECT COUNT(*) FROM admin_recovery_043 WHERE id=1";
            return Convert.ToInt32(q.ExecuteScalar())==0;
        }
    }

    public void CompleteOwnerRecovery043(string administrator,string pin,string confirmation)
    {
        administrator=(administrator??"").Trim();
        if(administrator.Length<2||administrator.Length>80)throw new ArgumentException("Nome inválido.");
        ValidatePin(pin);
        if(!string.Equals(pin,confirmation,StringComparison.Ordinal))throw new ArgumentException("Os campos do PIN são diferentes.");
        var salt=RandomNumberGenerator.GetBytes(24);
        var hash=Rfc2898DeriveBytes.Pbkdf2(pin,salt,Iterations,HashAlgorithmName.SHA256,32);
        using var c=_db.Open();using var tx=c.BeginTransaction();
        using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText="CREATE TABLE IF NOT EXISTS admin_recovery_043(id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT NOT NULL)";
            q.ExecuteNonQuery();
            q.CommandText="SELECT COUNT(*) FROM admin_recovery_043 WHERE id=1";
            if(Convert.ToInt32(q.ExecuteScalar())>0)throw new InvalidOperationException("Recuperação já concluída.");
        }
        using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"INSERT INTO administrator_pin_040(id,administrator,salt,hash,iterations,failed_attempts,locked_until,created_at)
VALUES(1,$name,$salt,$hash,$iterations,0,NULL,$at)
ON CONFLICT(id) DO UPDATE SET administrator=excluded.administrator,salt=excluded.salt,
hash=excluded.hash,iterations=excluded.iterations,failed_attempts=0,locked_until=NULL";
            q.Parameters.AddWithValue("$name",administrator);q.Parameters.AddWithValue("$salt",salt);
            q.Parameters.AddWithValue("$hash",hash);q.Parameters.AddWithValue("$iterations",Iterations);
            q.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
            if(q.ExecuteNonQuery()!=1)throw new IOException("A atualização administrativa falhou.");
        }
        using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText="INSERT INTO admin_recovery_043(id,completed_at) VALUES(1,$at)";
            q.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
            if(q.ExecuteNonQuery()!=1)throw new IOException("A confirmação da recuperação falhou.");
        }
        tx.Commit();
    }

    private static void ValidatePin(string pin)
    {
        if(string.IsNullOrEmpty(pin)||pin.Length<6||pin.Length>12||pin.Any(ch=>ch<'0'||ch>'9'))
            throw new ArgumentException("O PIN deve ter de 6 a 12 números.");
    }
}
