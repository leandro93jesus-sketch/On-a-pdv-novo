using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class Feature040Tests
{
    private static AppPaths Paths(string root)=>new(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));

    [Fact]
    public void Multivendas_RecoversEveryTabIndependentlyAfterRestart()
    {
        var dir=Path.Combine(Path.GetTempPath(),"onca-040-tabs-"+Guid.NewGuid().ToString("N"));
        try
        {
            var db=new OncaDatabase(Paths(dir));db.Migrate();
            var svc=new MultiSaleRecovery040(db,"terminal-teste");
            var id1=Guid.NewGuid();var id2=Guid.NewGuid();
            var state=new SaleTabsSnapshot040(2,4,new List<SaleTab040>{
                new(1,"João","JOÃO",id1,null,1m,new(){new(Guid.NewGuid(),"COD001","Sabão",2m,15m)}),
                new(2,"Entrega","CLIENTE DOIS",id2,null,2m,new(){new(Guid.NewGuid(),"COD002","Amaciante",3m,25m)}),
                new(3,"Balcão","CONSUMIDOR",null,null,0m,new())
            });
            svc.Save(state);
            var restart=new MultiSaleRecovery040(new OncaDatabase(Paths(dir)),"terminal-teste").Load()!;
            Assert.Equal(3,restart.Tabs.Count);
            Assert.Equal(2,restart.ActiveNumber);
            Assert.Equal(4,restart.NextNumber);
            Assert.Equal("João",restart.Tabs[0].Label);
            Assert.Equal(id1,restart.Tabs[0].CustomerId);
            Assert.Equal(2m,restart.Tabs[0].Items[0].Quantity);
            Assert.Equal("Entrega",restart.Tabs[1].Label);
            Assert.Equal(id2,restart.Tabs[1].CustomerId);
            Assert.Equal(3m,restart.Tabs[1].Items[0].Quantity);
            Assert.Empty(restart.Tabs[2].Items);
            // Simulate paid tab 2; tab 1 and 3 must remain unchanged.
            svc.Save(restart with{Tabs=new(){restart.Tabs[0],restart.Tabs[1] with{Items=new(),Discount=0,CustomerId=null,Label=""},restart.Tabs[2]}});
            var again=svc.Load()!;
            Assert.Single(again.Tabs[0].Items);
            Assert.Empty(again.Tabs[1].Items);
            Assert.Empty(again.Tabs[2].Items);
        }
        finally{try{if(Directory.Exists(dir))Directory.Delete(dir,true);}catch{}}
    }

    [Fact]
    public void Multivendas_SeparatesTerminalStateAndRejectsInvalidSnapshot()
    {
        var dir=Path.Combine(Path.GetTempPath(),"onca-040-terminal-"+Guid.NewGuid().ToString("N"));
        try
        {
            var db=new OncaDatabase(Paths(dir));db.Migrate();
            var a=new MultiSaleRecovery040(db,"terminal-A");
            var b=new MultiSaleRecovery040(db,"terminal-B");
            a.Save(new(1,2,new(){new(1,"A","CONSUMIDOR",null,null,0,new())}));
            Assert.Null(b.Load());
            Assert.Throws<InvalidDataException>(()=>a.Save(new(9,2,new(){new(1,"A","CONSUMIDOR",null,null,0,new())})));
            Assert.Equal(1,a.Load()!.ActiveNumber);
        }
        finally{try{if(Directory.Exists(dir))Directory.Delete(dir,true);}catch{}}
    }

    [Fact]
    public void AdminPin_NoDefaultPassword_WrongPinRejectedAndConfigurationCannotBeOverwritten()
    {
        var dir=Path.Combine(Path.GetTempPath(),"onca-040-admin-"+Guid.NewGuid().ToString("N"));
        try
        {
            var db=new OncaDatabase(Paths(dir));db.Migrate();
            var service=new AdminPinService040(db);
            Assert.False(service.IsConfigured);
            Assert.Throws<ArgumentException>(()=>service.Configure("Leandro","1234","1234"));
            service.Configure("Leandro","834769","834769");
            Assert.True(service.IsConfigured);
            Assert.Equal("Leandro",service.AdministratorName);
            Assert.False(service.Verify("000000"));
            Assert.True(service.Verify("834769"));
            Assert.Throws<InvalidOperationException>(()=>service.Configure("Outro","123456","123456"));
            var afterRestart=new AdminPinService040(new OncaDatabase(Paths(dir)));
            Assert.True(afterRestart.Verify("834769"));
        }
        finally{try{if(Directory.Exists(dir))Directory.Delete(dir,true);}catch{}}
    }
}
