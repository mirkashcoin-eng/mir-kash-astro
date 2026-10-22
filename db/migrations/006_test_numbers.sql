-- Two more internal test numbers. Anything they did is hidden from /admin unless
-- "Show test records" is on: people, visitors (so their browsing history), bookings in
-- the Action inbox, and orders (v_orders reads is_test through people).
INSERT INTO test_people (person_id, note) VALUES
  ('9892487704', 'test number'),
  ('9136878037', 'test number')
ON CONFLICT (person_id) DO NOTHING;

UPDATE people   SET is_test = true WHERE person_id IN (SELECT person_id FROM test_people) AND NOT is_test;
UPDATE visitors SET is_test = true WHERE person_id IN (SELECT person_id FROM test_people) AND NOT is_test;
