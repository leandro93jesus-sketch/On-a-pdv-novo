using System;
using System.IO;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class Recovery043Tests
{
    private static AppPaths Paths(string root)=>new(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));

    [Fact]
    public void PriorUpgradeAlreadyCompleted_RecoveryChangesOnlyAdminCredential()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-recovery043-"+Guid.NewGuid().ToString("N"));
        var oldPin=new string('8',6);var newPin=new string('7',6);
        try
        {
            var db=new OncaDatabase(Paths(root));db.Migrate();
            var auth=new AdminPinService040(db);
            auth.Configure("Anterior",oldPin,oldPin);
            auth.ConfigureOwnerPinOnce042("Anterior",oldPin,oldPin);
            Assert.False(auth.NeedsOwnerPinSetup042);
            Assert.True(auth.NeedsOwnerRecovery043);
            var product=Guid.NewGuid();
            using(var c=db.Open())using(var q=c.CreateCommand())
            {
                q.CommandText="INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES($id,'SAFE043','ITEM PRESERVADO',5,15,19,0,'UN',1)";
                q.Parameters.AddWithValue("$id",product.ToString());q.ExecuteNonQuery();
            }
            auth.CompleteOwnerRecovery043("Leandro",newPin,newPin);
            Assert.False(auth.NeedsOwnerRecovery043);
            Assert.True(auth.Verify(newPin));
            Assert.False(auth.Verify(oldPin));
            using(var c=db.Open())using(var q=c.CreateCommand())
            {
                q.CommandText="SELECT stock FROM products WHERE id=$id";
                q.Parameters.AddWithValue("$id",product.ToString());
                Assert.Equal(19m,Convert.ToDecimal(q.ExecuteScalar()));
            }
            Assert.Throws<InvalidOperationException>(()=>auth.CompleteOwnerRecovery043("Other",oldPin,oldPin));
            var restarted=new AdminPinService040(new OncaDatabase(Paths(root)));
            Assert.False(restarted.NeedsOwnerRecovery043);
            Assert.True(restarted.Verify(newPin));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public void InvalidOrMismatchedPinDoesNotMarkRecoveryAsCompleted()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-recovery043-validation-"+Guid.NewGuid().ToString("N"));
        var pin=new string('7',6);
        try
        {
            var db=new OncaDatabase(Paths(root));db.Migrate();
            var auth=new AdminPinService040(db);
            Assert.Throws<ArgumentException>(()=>auth.CompleteOwnerRecovery043("Leandro",pin,"wrong"));
            Assert.Throws<ArgumentException>(()=>auth.CompleteOwnerRecovery043("Leandro","123","123"));
            Assert.True(auth.NeedsOwnerRecovery043);
            auth.CompleteOwnerRecovery043("Leandro",pin,pin);
            Assert.True(auth.IsConfigured);
            Assert.False(auth.NeedsOwnerRecovery043);
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }
}
