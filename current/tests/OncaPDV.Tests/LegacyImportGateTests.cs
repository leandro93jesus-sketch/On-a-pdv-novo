using Microsoft.Data.Sqlite;
using OncaPDV.Infrastructure;
using OncaPDV.Migration;

namespace OncaPDV.Tests;

public sealed class LegacyImportGateTests
{
 [Fact]public async Task Dry_run_detects_tables_counts_financials_and_preserves_source_hash(){using var env=new Env();await env.CreateLegacy();var service=new LegacyImportService(env.Target);var report=await service.DryRunAsync(env.Legacy);Assert.Equal("SQLite",report.Format);Assert.True(report.SourcePreserved);Assert.Equal(report.Sha256Before,report.Sha256After);Assert.Equal(3,report.Entity("products").Found);Assert.Equal(2,report.Entity("customers").Found);Assert.Equal(1,report.Entity("sales").Found);Assert.Equal(1,report.Entity("credit").Found);Assert.Equal(1,report.Entity("suppliers").Found);Assert.Equal(1,report.Entity("purchases").Found);Assert.Equal(23,report.Entity("products").StockTotal);Assert.Equal(30,report.Entity("sales").FinancialTotal);Assert.False(report.ImportExecuted);}
 [Fact]public async Task Test_import_is_transactional_preserves_similar_names_and_is_idempotent(){using var env=new Env();await env.CreateLegacy();var service=new LegacyImportService(env.Target);var first=await service.ImportTestAsync(env.Legacy);Assert.False(first.AlreadyImported);Assert.Equal(3,first.Imported["products"]);Assert.Equal(2,first.Imported["customers"]);Assert.Equal(1,first.Imported["sales"]);Assert.Equal(1,first.Imported["credit"]);Assert.Equal(1,first.Imported["suppliers"]);Assert.Equal(1,first.Imported["purchases"]);Assert.Equal(23,first.StockAfter-first.StockBefore);Assert.Equal("ok",first.Integrity);var names=await env.Scalar("SELECT COUNT(*) FROM products WHERE name='DETERGENTE'");Assert.Equal(2,Convert.ToInt64(names));var second=await service.ImportTestAsync(env.Legacy);Assert.True(second.AlreadyImported);Assert.Equal(3,Convert.ToInt64(await env.Scalar("SELECT COUNT(*) FROM products WHERE internal_code LIKE 'P%'")));Assert.Equal(1,Convert.ToInt64(await env.Scalar("SELECT COUNT(*) FROM sales")));}

 [Fact]public async Task Real_v1_2_schema_with_cents_sku_and_missing_sku_is_supported_without_losing_products()
 {
  using var env=new Env();
  await env.CreateLegacyV12();
  var service=new LegacyImportService(env.Target);
  var dry=await service.DryRunAsync(env.Legacy);
  Assert.True(dry.SourcePreserved);
  Assert.Equal(4,dry.Entity("products").Found);
  Assert.Equal(4,dry.Entity("products").Importable);
  Assert.Equal(34.37m,dry.Entity("sales").FinancialTotal);
  var result=await service.ImportAsync(env.Legacy);
  Assert.False(result.AlreadyImported);
  Assert.Equal(4,result.Imported["products"]);
  Assert.Equal(1,result.Imported["sales"]);
  Assert.Equal(3,result.Imported["sale_items"]);
  Assert.Equal(1,result.Imported["payments"]);
  Assert.Equal(1,result.Imported["credit"]);
  Assert.Equal(1,result.Imported["credit_payments"]);
  Assert.Equal(1,result.Imported["cash_sessions"]);
  Assert.Equal(1,result.Imported["cash"]);
  Assert.Equal("Cash",Convert.ToString(await env.Scalar("SELECT reason FROM cash_movements WHERE type='Sale' LIMIT 1")));
  Assert.Equal(1,Convert.ToInt64(await env.Scalar("SELECT COUNT(*) FROM sale_items WHERE code='DIVERSOS' AND name='PRODUTO AVULSO'")));
  Assert.Equal(2,Convert.ToInt64(await env.Scalar("SELECT COUNT(*) FROM products WHERE name='DIVERSOS' AND internal_code LIKE 'LEGACY-%'")));
  Assert.Equal(34.37m,Convert.ToDecimal(await env.Scalar("SELECT total FROM sales LIMIT 1")));
  Assert.Equal("ok",result.Integrity);
  var again=await service.ImportAsync(env.Legacy);
  Assert.True(again.AlreadyImported);
 }

 [Fact]public async Task Duplicate_codes_are_reported_and_never_overwrite_target(){using var env=new Env();await env.CreateLegacy(duplicateCode:true);var report=await new LegacyImportService(env.Target).DryRunAsync(env.Legacy);Assert.True(report.Entity("products").Conflicts>0);Assert.NotEmpty(report.Conflicts);Assert.Equal(report.Sha256Before,report.Sha256After);}
 private sealed class Env:IDisposable
 {
  public string Root{get;}=Path.Combine(Path.GetTempPath(),"onca-legacy-gate-"+Guid.NewGuid());public string Legacy=>Path.Combine(Root,"backup-antigo.db");public OncaDatabase Target{get;}
  public Env(){Directory.CreateDirectory(Root);var paths=new AppPaths(Path.Combine(Root,"new"),Path.Combine(Root,"new","data"),Path.Combine(Root,"new","backups"),Path.Combine(Root,"new","logs"),Path.Combine(Root,"new","exports"),Path.Combine(Root,"new","print"));Target=new(paths);Target.Migrate();}
  public async Task CreateLegacy(bool duplicateCode=false){await using var c=new SqliteConnection($"Data Source={Legacy}");await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=$"""
CREATE TABLE produtos(id TEXT,codigo TEXT,codigo_barras TEXT,nome TEXT,estoque NUMERIC,preco NUMERIC,preco_custo NUMERIC,unidade TEXT);
INSERT INTO produtos VALUES('1','P1','789001','DETERGENTE',10,5,3,'UN'),('2','{(duplicateCode?"P1":"P2")}','789002','DETERGENTE',8,6,4,'UN'),('3','P3',NULL,'DETERGENTE NEUTRO',5,7,5,'UN');
CREATE TABLE clientes(id TEXT,nome TEXT,cpf TEXT,telefone TEXT);INSERT INTO clientes VALUES('c1','CLIENTE A','111','11'),('c2','CLIENTE B','222','22');
CREATE TABLE fornecedores(id TEXT,nome TEXT,cnpj TEXT);INSERT INTO fornecedores VALUES('f1','FORNECEDOR A','333');
CREATE TABLE vendas(id TEXT,cliente_id TEXT,total NUMERIC,data TEXT);INSERT INTO vendas VALUES('v1','c1',30,'2026-01-01');
CREATE TABLE itens_venda(id TEXT,venda_id TEXT,produto_id TEXT,quantidade NUMERIC,preco NUMERIC,nome TEXT);INSERT INTO itens_venda VALUES('i1','v1','1',2,5,'DETERGENTE');
CREATE TABLE crediario(id TEXT,cliente_id TEXT,venda_id TEXT,saldo NUMERIC);INSERT INTO crediario VALUES('cr1','c1','v1',20);
CREATE TABLE compras(id TEXT,fornecedor_id TEXT,total NUMERIC);INSERT INTO compras VALUES('co1','f1',15);
""";await q.ExecuteNonQueryAsync();}

  public async Task CreateLegacyV12()
  {
   await using var c=new SqliteConnection($"Data Source={Legacy}");await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText="""
CREATE TABLE products(id INTEGER,sku TEXT,barcode TEXT,name TEXT,category TEXT,price_cents INTEGER,cost_cents INTEGER,stock_qty INTEGER,active INTEGER,unit TEXT,min_stock_qty INTEGER,notes TEXT);
INSERT INTO products VALUES(1,'L-1','789001','DETERGENTE',NULL,249,100,10,1,'UN',1,NULL),(2,'L-2','789002','DETERGENTE',NULL,259,120,8,1,'UN',1,NULL),(3,NULL,NULL,'DIVERSOS',NULL,500,0,4,1,'UN',0,NULL),(4,NULL,NULL,'DIVERSOS',NULL,700,0,5,1,'UN',0,NULL);
CREATE TABLE customers(id INTEGER,name TEXT,document TEXT,phone TEXT,whatsapp TEXT,address TEXT,active INTEGER,created_at TEXT);INSERT INTO customers VALUES(1,'Cliente A','46073588860','15999999999',NULL,NULL,1,'2026-09-01T10:00:00-03:00');
CREATE TABLE cash_sessions(id INTEGER,operator_name TEXT,status TEXT,opening_amount_cents INTEGER,opened_at TEXT,closed_at TEXT,counted_amount_cents INTEGER);INSERT INTO cash_sessions VALUES(1,'Administrador','closed',1000,'2026-09-01T09:00:00-03:00','2026-09-01T18:00:00-03:00',4437);
CREATE TABLE sales(id INTEGER,sale_number TEXT,status TEXT,discount_cents INTEGER,total_cents INTEGER,created_at TEXT,customer_id INTEGER,cash_session_id INTEGER,amount_received_cents INTEGER,change_cents INTEGER);INSERT INTO sales VALUES(1,'000001','completed',0,3437,'2026-09-01T10:30:00-03:00',1,1,5000,1563);
CREATE TABLE sale_items(id INTEGER,sale_id INTEGER,product_id INTEGER,name TEXT,unit_price_cents INTEGER,quantity INTEGER,line_total_cents INTEGER);INSERT INTO sale_items VALUES(1,1,1,'DETERGENTE',249,2,498),(2,1,2,'DETERGENTE',259,1,259),(3,1,NULL,'PRODUTO AVULSO',2680,1,2680);
CREATE TABLE sale_payments(id INTEGER,sale_id INTEGER,method TEXT,amount_cents INTEGER,card_type TEXT,created_at TEXT);INSERT INTO sale_payments VALUES(1,1,'dinheiro',3437,NULL,'2026-09-01T10:30:00-03:00');
CREATE TABLE credit_accounts(id INTEGER,customer_id INTEGER,sale_id INTEGER,total_cents INTEGER,balance_cents INTEGER,installment_count INTEGER,status TEXT,created_at TEXT,notes TEXT);INSERT INTO credit_accounts VALUES(1,1,1,1200,500,1,'aberto','2026-09-01T10:30:00-03:00',NULL);
CREATE TABLE credit_installments(id INTEGER,credit_account_id INTEGER,due_date TEXT,amount_cents INTEGER,paid_cents INTEGER,status TEXT);INSERT INTO credit_installments VALUES(1,1,'2026-10-01',1200,700,'aberto');
CREATE TABLE credit_payments(id INTEGER,credit_account_id INTEGER,amount_cents INTEGER,method TEXT,paid_at TEXT,user_name TEXT,notes TEXT,is_reversal INTEGER);INSERT INTO credit_payments VALUES(1,1,700,'pix','2026-09-10T12:00:00-03:00','Administrador',NULL,0);
CREATE TABLE cash_movements(id INTEGER,cash_session_id INTEGER,movement_type TEXT,amount_cents INTEGER,payment_method TEXT,reason TEXT,reference_id INTEGER,created_at TEXT);INSERT INTO cash_movements VALUES(1,1,'venda',3437,'dinheiro','VENDA',1,'2026-09-01T10:30:00-03:00');
CREATE TABLE stock_movements(id INTEGER,product_id INTEGER,movement_type TEXT,quantity_delta INTEGER,reason TEXT,reference_id INTEGER,created_at TEXT);INSERT INTO stock_movements VALUES(1,1,'sale',-2,'VENDA',1,'2026-09-01T10:30:00-03:00');
CREATE TABLE suppliers(id INTEGER,name TEXT,document TEXT,phone TEXT,active INTEGER);
CREATE TABLE purchases(id INTEGER,purchase_number TEXT,supplier_id INTEGER,total_cents INTEGER,created_at TEXT);
CREATE TABLE purchase_items(id INTEGER,purchase_id INTEGER,product_id INTEGER,quantity INTEGER,unit_cost_cents INTEGER,line_total_cents INTEGER);
""";await q.ExecuteNonQueryAsync();
  }

  public async Task<object?> Scalar(string sql){await using var c=Target.Open();await using var q=c.CreateCommand();q.CommandText=sql;return await q.ExecuteScalarAsync();}
  public void Dispose(){SqliteConnection.ClearAllPools();if(Directory.Exists(Root))Directory.Delete(Root,true);}
 }
}
