from pathlib import Path

p = Path('work-final/ONCA-PDV-PRO/src/OncaPDV.Infrastructure/OrderService022.cs')
x = p.read_text(encoding='utf-8-sig')
old = 'new CartItem(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)'
new = 'new CartItem(x.ProductId ?? Guid.Empty,x.Code,x.Name,x.Quantity,x.UnitPrice)'
if old not in x:
    raise SystemExit('Target CartItem nullable ProductId pattern not found')
x = x.replace(old, new, 1)
p.write_text(x, encoding='utf-8')
print('FIX022_NULLABLE_APPLIED=YES')
