from pathlib import Path

p = Path('work-final/ONCA-PDV-PRO/src/OncaPDV.Infrastructure/OrderService022.cs')
x = p.read_text(encoding='utf-8')
old = 'new CartItem(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)'
new = 'new CartItem(x.ProductId ?? Guid.Empty,x.Code,x.Name,x.Quantity,x.UnitPrice)'
if old not in x:
    raise RuntimeError('Order CartItem reconstruction pattern not found')
p.write_text(x.replace(old, new), encoding='utf-8')
print('FIX022_GUID_APPLIED=YES')
