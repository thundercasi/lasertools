/*
  # Link a trade-in purchase to the originating sale

  ## Context
  Some parts (e.g. power supplies) are received as a trade-in: the
  customer hands over their broken unit when buying a replacement. That
  incoming unit is recorded as a purchase (usually at R$ 0 or an
  assessed value) so it flows into stock through the normal
  purchases -> stock formula. `related_sale_id` lets that purchase be
  traced back to the sale it came from, for reference — e.g. "this
  fonte came from customer X, sale VEN-0042".

  Nullable and unrelated to any stock/cost calculation — purely for
  traceability, shown when reviewing the purchase.
*/

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS related_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_related_sale ON purchases(related_sale_id);

NOTIFY pgrst, 'reload schema';
