using Microsoft.Data.Sqlite;
using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Tests;

public sealed class UpgradeSmokeTests
{
 [Fact]public async Task Upgrade_migration_preserves_operational_data_and_integrity()
 {
  using var env=new UpgradeEnvironment();env.Db.Migrate();await env.InsertFixture();var before=await env.Counts();env.Db.Migrate();var after=await env.Counts();Assert.Equal(before,after);Assert.All(after.Values,x=>Assert.True(x>0));Assert.Equal("ok",env.Db.IntegrityCheck());
 }
 [Fact]public async Task Upgrade_preserves_local_printer_and_central_configuration_files()
 {
  using var env=new UpgradeEnvironment();var printers=new TerminalPrinterProfileStore(env.Paths);var profile=new PrinterTerminalProfile("CAIXA-01","POS-80","USB001",80,PrintBackend.EscPosRaw,"CP850",false,false);await printers.SaveAsync(profile);var central=Path.Combine(env.Paths.Data,"central-database.json");await File.WriteAllTextAsync(central,"{\"TerminalId\":\"CAIXA-01\",\"Provider\":\"PostgreSQL\"}");env.Db.Migrate();Assert.Equal(profile,await printers.LoadAsync("CAIXA-01"));Assert.Contains("PostgreSQL",await File.ReadAllTextAsync(central));
 }
 private sealed class UpgradeEnvironment:IDisposable
 {
  public string Root{get;}=Path.Combine(Path.GetTempPath(),"onca-upgrade-"+Guid.NewGuid());public AppPaths Paths{get;}public OncaDatabase Db{get;}
  public UpgradeEnvironment(){Paths=new(Root,Path.Combine(Root,"data"),Path.Combine(Root,"backups"),Path.Combine(Root,"logs"),Path.Combine(Root,"exports"),Path.Combine(Root,"print"));Db=new(Paths);}
  public async Task InsertFixture(){await using var c=Db.Open();await using var q=c.CreateCommand();q.CommandText="""
INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES('p','UPGRADE-P','Produto preservado',1,2,10,1,'UN',1);
INSERT INTO customers(id,name,active) VALUES('c','Cliente preservado',1);
INSERT INTO suppliers(id,name,active) VALUES('f','Fornecedor preservado',1);
INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES('cx','op','2026-01-01T00:00:00Z',10);
INSERT INTO sales(id,number,created_at,operator_id,customer_id,cash_session_id,discount,total) VALUES('v',9001,'2026-01-01T00:00:00Z','op','c','cx',0,2);
INSERT INTO sale_items(id,sale_id,product_id,code,name,quantity,unit_price,subtotal) VALUES('vi','v','p','UPGRADE-P','Produto preservado',1,2,2);
INSERT INTO payments(id,sale_id,method,amount,change_amount) VALUES('pg','v','Cash',2,0);
INSERT INTO stock_movements(id,product_id,type,quantity,origin_id,reason,created_at) VALUES('e','p','Sale',-1,'v','Venda','2026-01-01T00:00:00Z');
INSERT INTO credit_accounts(id,customer_id,sale_id,original_amount,balance,created_at,due_at,status,installments) VALUES('cr','c','v',2,2,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z','Open',1);
INSERT INTO purchases(id,number,supplier_id,created_at,total) VALUES('co',7001,'f','2026-01-01T00:00:00Z',1);
""";await q.ExecuteNonQueryAsync();}
  public async Task<Dictionary<string,long>> Counts(){var result=new Dictionary<string,long>();await using var c=Db.Open();foreach(var table in new[]{"products","customers","suppliers","sales","sale_items","payments","stock_movements","credit_accounts","purchases"}){await using var q=c.CreateCommand();q.CommandText=$"SELECT COUNT(*) FROM {table}";result[table]=Convert.ToInt64(await q.ExecuteScalarAsync());}return result;}
  public void Dispose(){SqliteConnection.ClearAllPools();if(Directory.Exists(Root))Directory.Delete(Root,true);}
 }
}
