-- Set min and recommended margin to 40% for glass and mirror
-- Formula target (base_margin) is already 40% — now the minimum is also 40%
UPDATE pricing_formula SET value = 40 WHERE param_key = 'min_margin'          AND section IN ('glass', 'mirror');
UPDATE pricing_formula SET value = 40 WHERE param_key = 'recommended_margin'  AND section IN ('glass', 'mirror');
