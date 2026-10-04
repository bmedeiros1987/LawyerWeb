-- Fail closed if legacy duplicates exist. Never merge, delete or normalize users automatically.
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_casefold_key"
ON "User" (lower(btrim(email))) WHERE email IS NOT NULL;
