-- Purchases: payment method + first installment date
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'PIX';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS first_installment_date date;

-- Sales: NF tax, NF fee, salesperson commission (percentages)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS nf_tax numeric NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS nf_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS salesperson_commission numeric NOT NULL DEFAULT 0;