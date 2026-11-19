-- How many coupons a shop offers per promo ("64 left" on every phone). Null = no limit.
-- Checkout stops (pauseReason SOLD_OUT) once that many purchases are paid and not refunded.
alter table promotions
  add column if not exists coupon_total integer
    check (coupon_total is null or coupon_total between 1 and 100000);
