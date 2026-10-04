-- PLAN ONLY: not executed against production. Run only after separate authorization.
-- Reports counts and pseudonymous duplicate-group fingerprints, never passwords/tokens.
-- Do not automatically reconcile users or drop the unique index.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '1s';
SELECT current_database() AS database_name,
       current_setting('transaction_read_only') AS read_only;
SELECT count(*) AS users_total,
       count(*) FILTER (WHERE email IS NULL) AS null_emails,
       count(*) FILTER (WHERE email IS NOT NULL AND btrim(email) = '') AS blank_emails,
       count(*) FILTER (WHERE email IS NOT NULL AND email <> lower(btrim(email))) AS noncanonical_emails
FROM "User";
SELECT md5(lower(btrim(email))) AS normalized_email_group_fingerprint,
       count(*) AS conflicting_user_count
FROM "User"
WHERE email IS NOT NULL
GROUP BY lower(btrim(email))
HAVING count(*) > 1
ORDER BY conflicting_user_count DESC;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'User';
SELECT name, to_regclass(quote_ident(name)) IS NOT NULL AS exists
FROM (VALUES ('LocalCredential'), ('LocalSession'), ('LocalAuthChallenge'), ('LocalAuthRateLimit'), ('LocalAuthMailJob')) AS objects(name);
ROLLBACK;
