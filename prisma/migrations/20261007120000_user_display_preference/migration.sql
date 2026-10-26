-- Reading preferences per person (additive: new table only).
CREATE TABLE "UserDisplayPreference" (
    "userId" TEXT NOT NULL,
    "fontScale" INTEGER NOT NULL DEFAULT 100,
    "density" TEXT NOT NULL DEFAULT 'comfortable',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDisplayPreference_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserDisplayPreference" ADD CONSTRAINT "UserDisplayPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
