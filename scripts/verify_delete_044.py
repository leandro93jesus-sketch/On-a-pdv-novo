import os,sqlite3

root=os.environ["ONCA_PDV_DATA_ROOT"]
db=os.path.join(root,"data","onca-pdv-pro.db")
fixture=os.path.join(root,"ui-cancel-fixture.txt")
with open(fixture,encoding="utf-8") as f:
    sale1,sale2,product,session=[x.strip() for x in f]
with sqlite3.connect(db) as c:
    def scalar(sql,arg):
        return c.execute(sql,(arg,)).fetchone()[0]
    status1=scalar("SELECT status FROM sales WHERE id=?",sale1)
    status2=scalar("SELECT status FROM sales WHERE id=?",sale2)
    stock=scalar("SELECT stock FROM products WHERE id=?",product)
    cash=scalar("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id=?",session)
    events=scalar("SELECT COUNT(*) FROM sale_events WHERE sale_id=? AND event_type='Deleted'",sale1)
    reason=scalar("SELECT reason FROM sale_events WHERE sale_id=? AND event_type='Deleted'",sale1)
    items=scalar("SELECT COUNT(*) FROM sale_items WHERE sale_id=?",sale1)
    payments=scalar("SELECT COUNT(*) FROM payments WHERE sale_id=?",sale1)
    print("DELETE_044_DATABASE",status1,status2,stock,cash,events,items,payments,reason)
    assert status1=="Deleted" and status2=="Completed"
    assert stock==8 and cash==30
    assert events==1 and items==1 and payments==1
    assert "ADMIN:" in reason and "EXCLUSÃO:" in reason
    print("DELETE_044_GUI_AND_DATABASE_PASS=YES")
