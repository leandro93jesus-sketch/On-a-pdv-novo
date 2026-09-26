from pathlib import Path

root=Path("work-final/ONCA-PDV-PRO").resolve()
infra=root/"src"/"OncaPDV.Infrastructure"/"MultiSaleRecovery040.cs"
desktop=root/"src"/"OncaPDV.Desktop"
tests=root/"tests"/"OncaPDV.Tests"
s=infra.read_text(encoding="utf-8-sig")
anchor="    private static void ValidatePin(string pin)"
if s.count(anchor)!=1: raise RuntimeError("admin pin class anchor changed")
method=r'''
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

'''
s=s.replace(anchor,method+anchor,1)
infra.write_text(s,encoding="utf-8")
p=desktop/"MainWindow.xaml.cs"
c=p.read_text(encoding="utf-8-sig")
old='''        var ownerPin042=new AdminPinService040(_database);
        if(ownerPin042.NeedsOwnerPinSetup042)
        {
            var setup042=new AdminPinSetup042Window(_database){Owner=this};
            if(setup042.ShowDialog()!=true)
                MessageBox.Show("O PIN não foi redefinido. Abra novamente o PDV e configure-o para habilitar cancelamentos.","Autorização",MessageBoxButton.OK,MessageBoxImage.Warning);
        }'''
new='''        var ownerRecovery043=new AdminPinService040(_database);
        if(ownerRecovery043.NeedsOwnerRecovery043)
        {
            var recovery043=new AdminRecovery043Window(_database){Owner=this};
            if(recovery043.ShowDialog()!=true)
                MessageBox.Show("A autorização administrativa não foi redefinida. A recuperação será exibida novamente na próxima abertura.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Warning);
        }'''
if c.count(old)!=1:raise RuntimeError("expected original 0.1.42 dialog block")
c=c.replace(old,new,1)
p.write_text(c,encoding="utf-8")
(desktop/"AdminRecovery043Window.xaml").write_text(Path("scripts/feature043_recovery.xaml").read_text(encoding="utf-8"),encoding="utf-8")
(desktop/"AdminRecovery043Window.xaml.cs").write_text(Path("scripts/feature043_recovery.xaml.cs").read_text(encoding="utf-8"),encoding="utf-8")
(tests/"Recovery043Tests.cs").write_text(Path("scripts/feature043_tests.cs").read_text(encoding="utf-8")
print("ONCA_OWNER_RECOVERY_043_APPLIED=YES")
