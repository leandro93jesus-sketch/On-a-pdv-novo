from pathlib import Path

root=Path('work-final/ONCA-PDV-PRO').resolve()
infra=root/'src'/'OncaPDV.Infrastructure'/'MultiSaleRecovery040.cs'
desktop=root/'src'/'OncaPDV.Desktop'
tests=root/'tests'/'OncaPDV.Tests'

service=infra.read_text(encoding='utf-8-sig')
anchor='    private static void ValidatePin(string pin)'
if anchor not in service:raise RuntimeError('Expected AdminPinService040 anchor missing')
extension=r'''
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

'''
service=service.replace(anchor,extension+anchor,1)
infra.write_text(service,encoding='utf-8')

(desktop/'AdminPinSetup042Window.xaml').write_text(Path('scripts/feature042_admin_setup.xaml').read_text(encoding='utf-8'),encoding='utf-8')
(desktop/'AdminPinSetup042Window.xaml.cs').write_text(Path('scripts/feature042_admin_setup.xaml.cs').read_text(encoding='utf-8'),encoding='utf-8')
(tests/'PinSetup042Tests.cs').write_text(Path('scripts/feature042_pin_tests.cs').read_text(encoding='utf-8'),encoding='utf-8')

p=desktop/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
old='        var recoveredTabs040 = await RestoreMultiSales040();'
if c.count(old)!=1:raise RuntimeError('Missing recover-after-initialize anchor')
c=c.replace(old,old+'''
        // Upgrade once: permit the shop owner to replace an unknown previous PIN
        // without changing any product, sale, cash, inventory or cart data.
        var ownerPin042=new AdminPinService040(_database);
        if(ownerPin042.NeedsOwnerPinSetup042)
        {
            var setup042=new AdminPinSetup042Window(_database){Owner=this};
            if(setup042.ShowDialog()!=true)
                MessageBox.Show("O PIN não foi redefinido. Abra novamente o PDV e configure-o para habilitar cancelamentos.","Autorização",MessageBoxButton.OK,MessageBoxImage.Warning);
        }''',1)
p.write_text(c,encoding='utf-8')
print('ONCA_OWNER_PIN_SETUP_042_APPLIED=YES')
