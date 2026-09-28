import os,sqlite3,uuid,datetime,sys
root=os.environ["ONCA_PDV_DATA_ROOT"]
db=os.path.join(root,"data","onca-pdv-pro.db")
fixture=os.path.join(root,"credit-046-fixture.txt")
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
if len(sys.argv)<2:raise SystemExit("mode required")
if sys.argv[1]=="seed":
    customer=str(uuid.uuid4());product=str(uuid.uuid4());sale=str(uuid.uuid4());account=str(uuid.uuid4())
    op="10000000-0000-0000-0000-000000000001"
    with sqlite3.connect(db) as c:
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("INSERT INTO customers(id,name,active) VALUES(?,?,1)",(customer,"TESTE EXCLUSAO CREDIARIO 046"))
        c.execute("INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES(?,?,?,?,?,?,?,?,?)",
                  (product,"CREDITGUI046","Item credit test",5,100,19,0,"UN",1))
        c.execute("INSERT INTO sales(id,number,created_at,operator_id,customer_id,discount,total,status) VALUES(?,?,?,?,?,?,?,'Completed')",
                  (sale,98101,now,op,customer,0,100))
        c.execute("INSERT INTO sale_items(id,sale_id,product_id,code,name,quantity,unit_price,subtotal) VALUES(?,?,?,?,?,?,?,?)",
                  (str(uuid.uuid4()),sale,product,"CREDITGUI046","Item credit test",1,100,100))
        c.execute("INSERT INTO payments(id,sale_id,method,amount) VALUES(?,?,?,?)",(str(uuid.uuid4()),sale,"StoreCredit",100))
        c.execute("INSERT INTO credit_entries(id,customer_id,sale_id,type,amount,created_at,reason) VALUES(?,?,?,'Debit',?,?,'VENDA CREDIARIO')",
                  (str(uuid.uuid4()),customer,sale,100,now))
        c.execute("INSERT INTO credit_accounts(id,customer_id,sale_id,original_amount,balance,created_at,due_at,status,installments) VALUES(?,?,?,?,?,?,?,'Open',1)",
                  (account,customer,sale,100,100,now,now))
    with open(fixture,"w",encoding="utf-8") as f:f.write("\n".join([customer,product,sale,account]))
    print("CREDIT046_UI_FIXTURE_READY=YES")
elif sys.argv[1]=="check":
    with open(fixture,encoding="utf-8") as f:customer,product,sale,account=[s.strip() for s in f]
    with sqlite3.connect(db) as c:
        def one(sql,arg):
            return c.execute(sql,(arg,)).fetchone()[0]
        a=one("SELECT status FROM credit_accounts WHERE id=?",account)
        bal=one("SELECT balance FROM credit_accounts WHERE id=?",account)
        original=one("SELECT original_amount FROM credit_accounts WHERE id=?",account)
        status=one("SELECT status FROM sales WHERE id=?",sale)
        stock=one("SELECT stock FROM products WHERE id=?",product)
        deletion=one("SELECT removed_balance FROM credit_account_deletions_046 WHERE account_id=?",account)
        audit=one("SELECT COUNT(*) FROM sale_events WHERE sale_id=? AND event_type='CreditAccountDeleted'",sale)
        credits=one("SELECT COALESCE(SUM(amount),0) FROM credit_entries WHERE sale_id=? AND type='Credit'",sale)
        receipt_count=one("SELECT COUNT(*) FROM credit_receipts WHERE account_id=?",account)
        cash=one("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE origin_id=?",account)
        print("CREDIT046_UI_CHECK",a,bal,original,status,stock,deletion,audit,credits,receipt_count,cash)
        assert a=="Cancelled" and bal==0 and original==100 and status=="Completed" and stock==19
        assert deletion==100 and audit==1 and credits==100 and receipt_count==0 and cash==0
        print("CREDIT046_UI_DELETE_DB_PASS=YES")
else:raise SystemExit("unknown mode")
