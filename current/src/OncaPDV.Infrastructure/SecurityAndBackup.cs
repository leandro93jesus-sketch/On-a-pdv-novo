using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace OncaPDV.Infrastructure;

public enum UserRole { Administrator, Cashier, Stockkeeper }

public sealed record PdvUser(Guid Id,string Name,UserRole Role,string PinSalt,string PinHash,bool Active=true);

public sealed record AccessControlConfig(Guid ActiveUserId,List<PdvUser> Users)
{
    public static AccessControlConfig Default()
    {
        var adminId=Guid.Parse("10000000-0000-0000-0000-000000000001");
        var salt=Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        return new(adminId,[new(adminId,"Administrador",UserRole.Administrator,salt,AccessControlStore.HashPin("1234",salt),true)]);
    }
}

public sealed class AccessControlStore(AppPaths paths)
{
    private string FilePath=>Path.Combine(paths.Data,"access-control.json");

    public async Task<AccessControlConfig> LoadAsync(CancellationToken ct=default)
    {
        paths.EnsureCreated();
        if(!File.Exists(FilePath)){var cfg=AccessControlConfig.Default();await SaveAsync(cfg,ct);return cfg;}
        try
        {
            var cfg=JsonSerializer.Deserialize<AccessControlConfig>(await File.ReadAllTextAsync(FilePath,ct));
            if(cfg is not null&&cfg.Users.Count>0)return cfg;
        }
        catch { }
        var fallback=AccessControlConfig.Default();await SaveAsync(fallback,ct);return fallback;
    }

    public Task SaveAsync(AccessControlConfig cfg,CancellationToken ct=default)
    {
        paths.EnsureCreated();
        return File.WriteAllTextAsync(FilePath,JsonSerializer.Serialize(cfg,new JsonSerializerOptions{WriteIndented=true}),ct);
    }

    public async Task<PdvUser> ActiveUserAsync(CancellationToken ct=default)
    {
        var cfg=await LoadAsync(ct);
        return cfg.Users.FirstOrDefault(x=>x.Id==cfg.ActiveUserId&&x.Active)
               ??cfg.Users.First(x=>x.Active);
    }

    public async Task SetActiveUserAsync(Guid id,CancellationToken ct=default)
    {
        var cfg=await LoadAsync(ct);
        if(!cfg.Users.Any(x=>x.Id==id&&x.Active))throw new InvalidOperationException("Usuário inválido ou inativo.");
        await SaveAsync(cfg with{ActiveUserId=id},ct);
    }

    public async Task<bool> ValidatePinAsync(string pin,UserRole requiredRole=UserRole.Administrator,CancellationToken ct=default)
    {
        var cfg=await LoadAsync(ct);
        return cfg.Users.Where(x=>x.Active&&HasPermission(x.Role,requiredRole)).Any(x=>FixedEquals(x.PinHash,HashPin(pin,x.PinSalt)));
    }

    public static bool HasPermission(UserRole role,UserRole required)=>required switch
    {
        UserRole.Administrator=>role==UserRole.Administrator,
        UserRole.Stockkeeper=>role is UserRole.Administrator or UserRole.Stockkeeper,
        _=>true
    };

    public static PdvUser CreateUser(string name,UserRole role,string pin)
    {
        if(string.IsNullOrWhiteSpace(name))throw new ArgumentException("Informe o nome do usuário.");
        if(pin.Length<4)throw new ArgumentException("O PIN deve ter pelo menos 4 dígitos.");
        var salt=Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        return new(Guid.NewGuid(),name.Trim(),role,salt,HashPin(pin,salt),true);
    }

    public static PdvUser ChangePin(PdvUser user,string pin)
    {
        if(pin.Length<4)throw new ArgumentException("O PIN deve ter pelo menos 4 dígitos.");
        var salt=Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        return user with{PinSalt=salt,PinHash=HashPin(pin,salt)};
    }

    internal static string HashPin(string pin,string salt)
    {
        using var sha=SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes($"ONCA-PDV|{salt}|{pin}")));
    }

    private static bool FixedEquals(string a,string b)
    {
        try{return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(a),Convert.FromHexString(b));}
        catch{return false;}
    }
}

public sealed record BackupPreferences(bool Enabled=true,int WarnAfterHours=30,string? ExternalFolder=null,int KeepDays=30);

public sealed class BackupPreferencesStore(AppPaths paths)
{
    private string FilePath=>Path.Combine(paths.Data,"backup-preferences.json");
    public async Task<BackupPreferences> LoadAsync(CancellationToken ct=default)
    {
        paths.EnsureCreated();
        if(!File.Exists(FilePath))return new();
        try{return JsonSerializer.Deserialize<BackupPreferences>(await File.ReadAllTextAsync(FilePath,ct))??new();}
        catch{return new();}
    }
    public async Task SaveAsync(BackupPreferences p,CancellationToken ct=default)
    {
        paths.EnsureCreated();
        await File.WriteAllTextAsync(FilePath,JsonSerializer.Serialize(p,new JsonSerializerOptions{WriteIndented=true}),ct);
    }
}
