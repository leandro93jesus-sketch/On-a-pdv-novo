import os,sqlite3,hashlib,secrets,datetime,sys
root=os.environ["ONCA_PDV_DATA_ROOT"]
folder=os.path.join(root,"data")
os.makedirs(folder,exist_ok=True)
db=os.path.join(folder,"onca-pdv-pro.db")
at=datetime.datetime.now(datetime.timezone.utc).isoformat()
with sqlite3.connect(db) as c:
    c.execute("""CREATE TABLE IF NOT EXISTS administrator_pin_040(
id INTEGER PRIMARY KEY CHECK(id=1),administrator TEXT NOT NULL,salt BLOB NOT NULL,
hash BLOB NOT NULL,iterations INTEGER NOT NULL,failed_attempts INTEGER NOT NULL DEFAULT 0,
locked_until TEXT,created_at TEXT NOT NULL)""")
    c.execute("CREATE TABLE IF NOT EXISTS admin_pin_setup_042(id INTEGER PRIMARY KEY CHECK(id=1),completed_at TEXT NOT NULL)")
    pin="8"*6
    salt=secrets.token_bytes(24)
    key=hashlib.pbkdf2_hmac("sha256",pin.encode(),salt,210000,32)
    c.execute("INSERT INTO administrator_pin_040(id,administrator,salt,hash,iterations,failed_attempts,locked_until,created_at) VALUES(1,?,?,?,?,2,NULL,?)",("Previous",salt,key,210000,at))
    c.execute("INSERT INTO admin_pin_setup_042(id,completed_at) VALUES(1,?)",(at,))
    assert c.execute("SELECT COUNT(*) FROM admin_pin_setup_042").fetchone()[0]==1
    assert c.execute("SELECT COUNT(*) FROM admin_recovery_043").fetchone()[0]==0 if c.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='admin_recovery_043'").fetchone()[0] else True
print("PREVIOUS_ADMIN_042_ALREADY_CONFIGURED=YES")
