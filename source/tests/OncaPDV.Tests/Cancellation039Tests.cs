using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class Cancellation039Tests
{
    [Fact]
    public async Task CancelCompletedSale_OnlySelectedSale_AndItsStockCashAndAudit()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-cancel-039-"+Guid.NewGuid().ToString("N"));
        var paths=new AppPaths(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
        try
        {
            var db=new OncaDatabase(paths);db.Migrate();
            var product=Guid.NewGuid();var session=Guid.NewGuid();var op=Guid.NewGuid();
            var first=Guid.NewGuid();var second=Guid.NewGuid();var at=DateTimeOffset.Now.ToString("O");
            await using(var conn=db.Open())
            {
                async Task Exec(string sql)
                {
                    await using var q=conn.CreateCommand();q.CommandText=sql;await q.ExecuteNonQueryAsync();
                }
                await Exec($"INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES('{product}','CANCEL039','Teste',5,15,6,0,'UN',1)");
                await Exec($"INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES('{session}','{op}','{at}',0)");
                await Exec($"INSERT INTO sales(id,number,created_at,operator_id,cash_session_id,discount,total) VALUES('{first}',90001,'{at}','{op}','{session}',0,30)");
                await Exec($"INSERT INTO sales(id,number,created_at,operator_id,cash_session_id,discount,total) VALUES('{second}',90002,'{at}','{op}','{session}',0,30)");
                foreach(var sale in new[]{first,second})
                {
                    await Exec($"INSERT INTO sale_items(id,sale_id,product_id,code,name,quantity,unit_price,subtotal) VALUES('{Guid.NewGuid()}','{sale}','{product}','CANCEL039','Teste',2,15,30)");
                    await Exec($"INSERT INTO payments(id,sale_id,method,amount,change_amount) VALUES('{Guid.NewGuid()}','{sale}','Cash',30,0)");
                    await Exec($"INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at) VALUES('{Guid.NewGuid()}','{session}','Sale',30,'{sale}','Cash','{at}')");
                }
            }
            var service=new AdvancedOperationsService(db);
            await service.CancelSaleAsync(first,op,"Teste de estorno por seleção");

            await using(var conn=db.Open())
            {
                async Task<string> S(string sql)
                {
                    await using var q=conn.CreateCommand();q.CommandText=sql;return Convert.ToString(await q.ExecuteScalarAsync())??"";
                }
                Assert.Equal("Cancelled",await S($"SELECT status FROM sales WHERE id='{first}'"));
                Assert.Equal("Completed",await S($"SELECT status FROM sales WHERE id='{second}'"));
                Assert.Equal(8m,Convert.ToDecimal(await S($"SELECT stock FROM products WHERE id='{product}'")));
                Assert.Equal(30m,Convert.ToDecimal(await S($"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id='{session}'")));
                Assert.Equal("1",await S($"SELECT COUNT(*) FROM sale_events WHERE sale_id='{first}' AND event_type='Cancelled' AND reason='Teste de estorno por seleção'"));
                Assert.Equal("0",await S($"SELECT COUNT(*) FROM sale_events WHERE sale_id='{second}' AND event_type='Cancelled'"));
            }
            await Assert.ThrowsAsync<DomainException>(()=>service.CancelSaleAsync(first,op,"Duplicado"));
        }
        finally
        {
            try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}
        }
    }
}
