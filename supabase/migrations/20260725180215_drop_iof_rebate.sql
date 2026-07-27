/*
  # Drop unused iof_rebate column

  The `iof_rebate` column on `purchases` is no longer used by the app.
*/

ALTER TABLE purchases DROP COLUMN IF EXISTS iof_rebate;
