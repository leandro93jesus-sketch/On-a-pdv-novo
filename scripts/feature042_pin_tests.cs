using System;
using System.IO;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class PinSetup042Tests
{
    [Fact]
    public void FirstUpgrade_ReplacesUnknownPinExactlyOnce_AndLeavesCommercialDataUntouched()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-042-"+Guid.NewGuid().ToString("N"));
        var paths=new AppPaths(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
        var oldPin=new string('5',6);var newPin=new string('7',6);var unusedPin=new string('1',6);
        try
        {
            var db=new OncaDatabase(paths);db.Migrate();
            var service=new AdminPinService040(db);
            service.Configure("Old Admin",oldPin,oldPin);
            var pid=Guid.NewGuid();
            using(var c=db.Open())
            using(var q=c.CreateCommand())
            {
                q.CommandText="INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES($id,'PIN042','PRODUTO INALTERADO',5,15,17,0,'UN',1)";
                q.Parameters.AddWithValue("$id",pid.ToString());
                q.ExecuteNonQuery();
            }
            Assert.True(service.NeedsOwnerPinSetup042);
            service.ConfigureOwnerPinOnce042("Leandro",newPin,newPin);
            Assert.True(service.Verify(newPin));
            Assert.False(service.Verify(oldPin));
            Assert.False(service.NeedsOwnerPinSetup042);
            using(var c=db.Open())
            using(var q=c.CreateCommand())
            {
                q.CommandText="SELECT stock FROM products WHERE id=$id";q.Parameters.AddWithValue("$id",pid.ToString());
                Assert.Equal(17m,Convert.ToDecimal(q.ExecuteScalar()));
            }
            Assert.Throws<InvalidOperationException>(()=>service.ConfigureOwnerPinOnce042("Other",unusedPin,unusedPin));
            var restarted=new AdminPinService040(new OncaDatabase(paths));
            Assert.False(restarted.NeedsOwnerPinSetup042);
            Assert.True(restarted.Verify(newPin));
            Assert.False(restarted.Verify(unusedPin));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public void Setup_RequiresValidAndMatchingPinWithoutPartialMarker()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-042-validation-"+Guid.NewGuid().ToString("N"));
        var paths=new AppPaths(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
        var shortPin=new string('1',3);var validPin=new string('7',6);var otherPin=new string('0',6);
        try
        {
            var db=new OncaDatabase(paths);db.Migrate();
            var service=new AdminPinService040(db);
            Assert.Throws<ArgumentException>(()=>service.ConfigureOwnerPinOnce042("Leandro",shortPin,shortPin));
            Assert.Throws<ArgumentException>(()=>service.ConfigureOwnerPinOnce042("Leandro",validPin,otherPin));
            Assert.True(service.NeedsOwnerPinSetup042);
            service.ConfigureOwnerPinOnce042("Leandro",validPin,validPin);
            Assert.True(service.IsConfigured);
            Assert.False(service.NeedsOwnerPinSetup042);
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }
}
