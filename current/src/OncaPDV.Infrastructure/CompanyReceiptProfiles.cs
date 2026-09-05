using System.Text.Json;

namespace OncaPDV.Infrastructure;

public sealed record CompanyReceiptProfile(
    string FantasyName = "ONCA PRODUTOS DE LIMPEZA",
    string? LegalName = null,
    string? Cnpj = null,
    string? StateRegistration = null,
    string? Phone = null,
    string? AddressLine1 = null,
    string? AddressLine2 = null,
    string FooterMessage = "OBRIGADO PELA PREFERENCIA")
{
    public static CompanyReceiptProfile Default() => new();
}

public sealed class CompanyReceiptProfileStore(AppPaths paths)
{
    private string FilePath => Path.Combine(paths.Data, "company-receipt.json");

    public async Task<CompanyReceiptProfile> LoadAsync(CancellationToken ct = default)
    {
        paths.EnsureCreated();
        if (!File.Exists(FilePath)) return CompanyReceiptProfile.Default();
        try
        {
            var json = await File.ReadAllTextAsync(FilePath, ct);
            return JsonSerializer.Deserialize<CompanyReceiptProfile>(json) ?? CompanyReceiptProfile.Default();
        }
        catch
        {
            return CompanyReceiptProfile.Default();
        }
    }

    public async Task SaveAsync(CompanyReceiptProfile profile, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(profile.FantasyName))
            throw new ArgumentException("Informe o nome que será impresso no comprovante.");

        var cnpjDigits = Digits(profile.Cnpj);
        if (cnpjDigits.Length is > 0 and not 14)
            throw new ArgumentException("CNPJ deve ter 14 dígitos ou ficar em branco.");

        paths.EnsureCreated();
        var normalized = profile with
        {
            FantasyName = profile.FantasyName.Trim(),
            LegalName = Clean(profile.LegalName),
            Cnpj = Clean(profile.Cnpj),
            StateRegistration = Clean(profile.StateRegistration),
            Phone = Clean(profile.Phone),
            AddressLine1 = Clean(profile.AddressLine1),
            AddressLine2 = Clean(profile.AddressLine2),
            FooterMessage = string.IsNullOrWhiteSpace(profile.FooterMessage)
                ? "OBRIGADO PELA PREFERENCIA"
                : profile.FooterMessage.Trim()
        };

        var temp = FilePath + ".tmp";
        await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(normalized, new JsonSerializerOptions { WriteIndented = true }), ct);
        File.Move(temp, FilePath, true);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string Digits(string? value) => string.Concat((value ?? string.Empty).Where(char.IsDigit));
}
