-- LawyerMind desktop: initial local schema.
-- Mirrors the naming of the web Prisma models (Client, Matter, LegalDocument) in a
-- reduced, single-office form. Records are never deleted by the app: they are archived.

create table clients (
  id text primary key,
  type text not null default 'LEGAL_ENTITY' check (type in ('INDIVIDUAL','LEGAL_ENTITY')),
  name text not null check (length(btrim(name)) > 0),
  legal_name text,
  cpf_cnpj text,
  email text,
  phone text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_name_idx on clients (lower(name));
create index clients_cpf_cnpj_idx on clients (cpf_cnpj);

create table matters (
  id text primary key,
  client_id text not null references clients(id) on delete restrict,
  number text,
  title text not null check (length(btrim(title)) > 0),
  type text not null default 'LITIGATION' check (type in ('LITIGATION','ADVISORY','ADMINISTRATIVE','OTHER')),
  practice_area text,
  court text,
  jurisdiction text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index matters_client_idx on matters (client_id);
create index matters_number_idx on matters (number);

-- relative_path is always relative to the documents folder chosen on this machine,
-- with '/' separators, so the folder can be moved or restored elsewhere.
create table documents (
  id text primary key,
  client_id text not null references clients(id) on delete restrict,
  matter_id text references matters(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  relative_path text not null unique,
  original_name text,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_client_idx on documents (client_id);
create index documents_matter_idx on documents (matter_id);
