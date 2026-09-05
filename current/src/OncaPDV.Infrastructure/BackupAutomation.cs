using System.Text.Json;

namespace OncaPDV.Infrastructure;

public sealed record AutomaticBackupSettings(bool Enabled = true, int Retention = 30, string? ExternalFolder = null);

public sealed class AutomaticBackupSettingsStore(AppPaths paths)
{
    private string FilePath => Path.Combine(paths.Data, "backup-settings.json");

    public async Task<AutomaticBackupSettings> LoadAsync(CancellationToken ct = default)
    {
        paths.EnsureCreated();
        if (!File.Exists(FilePath)) return new();
        try
        {
            var json = await File.ReadAllTextAsync(FilePath, ct);
            return JsonSerializer.Deserialize<AutomaticBackupSettings>(json) ?? new();
        }
        catch { return new(); }
    }

    public async Task SaveAsync(AutomaticBackupSettings settings, CancellationToken ct = default)
    {
        if (settings.Retention < 3 || settings.Retention > 365)
            throw new ArgumentException("A retenção deve ficar entre 3 e 365 backups.");
        paths.EnsureCreated();
        var normalized = settings with { ExternalFolder = string.IsNullOrWhiteSpace(settings.ExternalFolder) ? null : settings.ExternalFolder.Trim() };
        await File.WriteAllTextAsync(FilePath, JsonSerializer.Serialize(normalized, new JsonSerializerOptions { WriteIndented = true }), ct);
    }
}
