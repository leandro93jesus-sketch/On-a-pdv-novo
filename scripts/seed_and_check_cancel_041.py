import os,sys,sqlite3,uuid,datetime
root=os.environ["ONCA_PDV_DATA_ROOT"]
db=os.path.join(root,"data","onca-pdv-pro.db")
if not os.path.isfile(db): raise SystemExit("Database not initialized: "+db)
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
product=str(uuid.uuid4());session=str(uuid.uuid4());op="10000000-0000-0000-0000-000000000001"
s1=str(uuid.uuid4());s2=str(uuid.uuid4())
path=os.path.join(root,"ui-cancel-fixture.txt")
def seed():
    with sqlite3.connect(db) as c:
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active) VALUES(?,?,?,?,?,?,?,?,?)",
                  (product,"UITEST041","Produto teste cancelamento",5,15,6,0,"UN",1))
        c.execute("INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES(?,?,?,?)",(session,op,now,0))
        for num,sid in [(94101,s1),(94102,s2)]:
            c.execute("INSERT INTO sales(id,number,created_at,operator_id,cash_session_id,discount,total) VALUES(?,?,?,?,?,?,?)",
                      (sid,num,now,op,session,0,30))
            c.execute("INSERT INTO sale_items(id,sale_id,product_id,code,name,quantity,unit_price,subtotal) VALUES(?,?,?,?,?,?,?,?)",
                      (str(uuid.uuid4()),sid,product,"UITEST041","Produto teste cancelamento",2,15,30))
            c.execute("INSERT INTO payments(id,sale_id,method,amount,change_amount) VALUES(?,?,?,?,?)",
                      (str(uuid.uuid4()),sid,"Cash",30,0))
            c.execute("INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at) VALUES(?,?,?,?,?,?,?)",
                      (str(uuid.uuid4()),session,"Sale",30,sid,"Cash",now))
    with open(path,"w") as f: f.write("\n".join([s1,s2,product,session]))
    print("UI_CANCEL_SEEDED sale_numbers=94101,94102 expected_cash=60 expected_stock=6")
def check():
    with open(path) as f: a=[x.strip() for x in f]
    s1,s2,pid,cash=a
    with sqlite3.connect(db) as c:
        def value(sql,param):return c.execute(sql,(param,)).fetchone()[0]
        a=value("SELECT status FROM sales WHERE id=?",s1)
        b=value("SELECT status FROM sales WHERE id=?",s2)
        stock=value("SELECT stock FROM products WHERE id=?",pid)
        amount=value("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id=?",cash)
        events=value("SELECT COUNT(*) FROM sale_events WHERE sale_id=? AND event_type='Cancelled'",s1)
        pin=c.execute("SELECT COUNT(*) FROM administrator_pin_040 WHERE id=1").fetchone()[0]
        reason=value("SELECT reason FROM sale_events WHERE sale_id=? AND event_type='Cancelled'",s1)
        print("UI_CANCEL_CHECK",{"sale_94101":a,"sale_94102":b,"stock":stock,"cash":amount,"audit_events":events,"admin_configured":pin,"reason":reason})
        assert a=="Cancelled" and b=="Completed" and stock==8 and amount==30 and events==1 and pin==1
        assert "ADMIN:" in reason and "MOTIVO:" in reason and "Teste de cancelamento UI" in reason
    print("UI_CANCEL_END_TO_END_DB_OK")
def check_second():
    with open(path) as f: s1,s2,pid,cash=[x.strip() for x in f]
    with sqlite3.connect(db) as c:
        def one(sql,value):return c.execute(sql,(value,)).fetchone()[0]
        assert one("SELECT status FROM sales WHERE id=?",s1)=="Cancelled"
        assert one("SELECT status FROM sales WHERE id=?",s2)=="Cancelled"
        assert one("SELECT stock FROM products WHERE id=?",pid)==10
        assert one("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id=?",cash)==0
        assert one("SELECT COUNT(*) FROM sale_events WHERE sale_id=? AND event_type='Cancelled'",s1)==1
        assert one("SELECT COUNT(*) FROM sale_events WHERE sale_id=? AND event_type='Cancelled'",s2)==1
        reason=one("SELECT reason FROM sale_events WHERE sale_id=? AND event_type='Cancelled'",s2)
        assert "ADMIN: Administrador Teste" in reason and "Segunda venda com PIN correto" in reason
    print("UI_CANCEL_SECOND_PIN_END_TO_END_DB_OK")
if __name__=="__main__":
    if sys.argv[1]=="seed":seed()
    elif sys.argv[1]=="check":check()
    elif sys.argv[1]=="check_second":check_second()
    else:raise SystemExit("Unknown test command")
