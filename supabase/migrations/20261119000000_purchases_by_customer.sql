-- "My purchases" lookup for the customer app (GET /api/purchases?customer=).
create index if not exists purchases_customer_created_idx on purchases (customer, created_at desc);
