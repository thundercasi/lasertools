/*
  # Drop unused competition_prices.url column

  The URL field was removed from the competitor price screen — the price
  entry no longer needs a link to the source page.
*/

ALTER TABLE competition_prices DROP COLUMN IF EXISTS url;
