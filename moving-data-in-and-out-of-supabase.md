# Moving data in and out of Supabase

**Scope:** how to get data into a Supabase Postgres database and out of it, with
special attention to AWS as the other end (RDS, Aurora, S3, Redshift). Covers
one-time migration, ongoing sync, and query-in-place. Batch vs streaming, size
limits, and the operational gotchas.

**Our position, stated plainly:**

- **Into Supabase** — fully supported, multiple paths keyed to data size. One-time
  migration and minimal-downtime cutover are both first-class.
- **Out of Supabase, managed** — supported, but the managed pipeline (Supabase ETL)
  currently lands data in **BigQuery only**.
- **Out of Supabase, to AWS** — we do **not** offer a managed AWS destination today.
  The supported pattern is **self-managed logical replication** (AWS DMS, Airbyte,
  Fivetran, Estuary) or **query-in-place** via Foreign Data Wrappers. This is a
  deliberate pattern, not a missing feature — see §3.
- **Read external data without copying it in** — supported via Wrappers (S3, Iceberg,
  warehouses) and analytics buckets.

Every claim below cites the doc page it comes from, in `source: path` form, so it
can be verified against the mirror.

---

## 1. Decision matrix

| You want to… | Direction | Mode | Use | Primary doc |
|---|---|---|---|---|
| Load a CSV / small dataset | in | batch | Dashboard import (≤100 MB) | `supabase: guides/database/import-data` |
| Bulk-load from MySQL/MSSQL | in | batch | pgloader | `supabase: guides/database/import-data`; `pgloader` |
| Migrate a Postgres DB in | in | batch / cutover | pg_dump+psql, or logical replication | `supabase: guides/platform/migrating-to-supabase/postgres` |
| Migrate off RDS | in | batch | pgloader / dump-restore | `supabase: guides/platform/migrating-to-supabase/amazon-rds`; `aws-rds` |
| Stream changes to a warehouse | out | streaming | Supabase ETL (managed) → **BigQuery** | `supabase: guides/database/replication/external-replication-setup` |
| Stream changes to **AWS** | out | streaming | Self-managed logical replication → AWS DMS | `supabase: guides/database/replication/manual-replication-setup`; `aws-dms` |
| Nightly extract to a warehouse | out | batch | Wrappers + pg_cron | `supabase: guides/database/extensions/wrappers/overview` |
| Read S3 / Parquet without importing | in-place | n/a | S3 Wrapper (read-only) | `supabase-wrappers: catalog/s3` |
| Read another warehouse live | in-place | n/a | Wrappers (BigQuery/ClickHouse/Snowflake/…) | `supabase-wrappers: catalog/*` |
| Lower-latency reads, no export | (in-region) | n/a | Read replica | `supabase: guides/platform/read-replicas` |
| Ship logs to S3 | out | streaming | Log drains | `supabase: guides/platform/log-drains` |

---

## 2. Data IN

### 2.1 By size (one-time / periodic)

`source: supabase: guides/database/import-data`

| Method | Best for | Limit / note |
|---|---|---|
| Dashboard CSV import | quick / dev datasets | **100 MB** hard limit |
| `pgloader` | MySQL / MS SQL → Postgres | converts schema + data; see §2.3 |
| `COPY` / `\COPY` | large CSV bulk load | `source: supabase: guides/database/tables#bulk-data-loading` |
| Supabase API (PostgREST/SDK) | programmatic / automated | avoid bulk inserts via the API |

**Prepare before a large import** (`source: supabase: guides/database/import-data`):
1. Back up first (`guides/platform/backups`).
2. Raise the statement timeout for the session (`guides/database/postgres/configuration`).
3. Pre-size the disk (`guides/platform/database-size#disk-management`).
4. Disable triggers during load, re-enable after (`ALTER TABLE … DISABLE TRIGGER ALL`).
5. Build indexes **after** the load, not during.

API-layer mechanics (bulk insert/upsert, resource embedding) are documented in
`source: postgrest` (now mirrored), behind Supabase's auto-generated REST API.

### 2.2 Migrating a Postgres database in

`source: supabase: guides/platform/migrating-to-supabase/postgres` — three methods:

1. **Google Colab** — easiest, scripted, good for moderate sizes.
2. **Manual dump/restore** — `pg_dump` (parallel `-j` tuned to source/target cores) →
   `pg_restore`. Sets the source read-only for a clean production cutover; covers
   statistics refresh, verification, and time estimates.
3. **Logical replication** — minimal-downtime. Configure `wal_level=logical`, set
   `REPLICA IDENTITY`, export schema only, create publication on source + subscription
   on Supabase, **synchronize sequences** (the commonly-missed step), then cut over.

CLI commands for these (`supabase db dump`, connection strings) are in
`source: supabase-cli: supabase/db/dump` and `source: supabase: guides/database/connecting-to-postgres`.

### 2.3 Migrating off Amazon RDS

`source: supabase: guides/platform/migrating-to-supabase/amazon-rds`

- **RDS MySQL / MS SQL** → pgloader (schema conversion + data).
- **RDS Postgres** → use the Postgres methods in §2.2 (dump/restore or logical replication).
- Source-side export mechanics (snapshot export, `pg_dump` from RDS, enabling logical
  replication on RDS) are in `source: aws-rds: AmazonRDS/latest/UserGuide` and, for Aurora,
  `source: aws-aurora`.

> **Note:** the upstream `amazon-rds` guide is thin and currently leans on a community
> Colab notebook. For Postgres-on-RDS, the §2.2 Postgres guide is the higher-quality path.

---

## 3. Data OUT

Three tiers, in order of how managed they are.

### 3.1 Read replicas (stays inside Supabase)

`source: supabase: guides/platform/read-replicas` — a synchronized read-only copy for
offloading reads / analytics. Not an export; included here because it's the first thing
people reach for and often the right answer when the goal is "reduce load," not "move data."

### 3.2 Managed external replication (Supabase ETL)

`source: supabase: guides/database/replication` and `.../external-replication-setup`

- Dashboard-driven, powered by Supabase ETL (`source: supabase-etl`).
- **Destination: BigQuery only today.** The setup guide states *"BigQuery is currently
  available, and we are working on new destinations."* There is **no AWS destination**.
- Built on Postgres logical replication. You define a **publication** (specific tables,
  whole schema, column subsets, or row predicates) and the pipeline streams changes.
- Tunable (`source: .../external-replication-setup`): batch wait time (default 10000 ms),
  table sync workers (default 4), copy connections per table (default 2), invalidated-slot
  behavior (Error vs Recreate).
- Engine internals — architecture, event model, schema-change handling, and the
  non-BigQuery destinations under development (ClickHouse, Snowflake, Iceberg, DuckLake) —
  are in `source: supabase-etl: docs/explanation/*` and `crates/etl-destinations/*`.

### 3.3 Self-managed replication → AWS (the supported AWS pattern)

`source: supabase: guides/database/replication/manual-replication-setup`

Because there is no managed AWS destination, the **supported** path to AWS is to drive
Postgres logical replication yourself with a tool that supports it. Prerequisites:
instance size XL+, IPv4 add-on, and a replication slot created as the `postgres` user
(`source: supabase: guides/database/postgres/setup-replication-external`).

Supported tools (the doc gives Supabase-specific deltas for each): **AWS DMS**, Airbyte,
Estuary, Fivetran, Materialize, Stitch.

**AWS DMS specifics** (`source: supabase: .../manual-replication-setup` + `source: aws-dms`):
- Use the `postgres` user (or `ALTER USER <u> WITH REPLICATION`).
- Set `pluginname` to `test-decoding`.
- The DMS pre-assessment may fail; it is not required.
- Increase `wal_sender_timeout` / `max_wal_size` via the Supabase CLI
  (`guides/platform/custom-postgres-config`).
- DMS replicates schema changes and is the natural choice when your infra is already in AWS.
- DMS source/target details (Postgres source setup, CDC, targeting S3 / Redshift / RDS) are
  documented end-to-end in `source: aws-dms: dms/latest/userguide` — see the
  `CHAP_Source.*PostgreSQL` and zero-ETL pages.

**Targeting Redshift / S3:**
- Redshift load/unload mechanics (`COPY` from S3, `UNLOAD` to S3) are in
  `source: aws-redshift: redshift/latest/dg`.
- For managed ETL into AWS analytics stores, AWS Glue is the AWS-native option
  (`source: aws-glue`); Kinesis Data Streams covers streaming ingestion
  (`source: aws-kinesis`).

**Gotchas for any logical-replication-out path** (`source: supabase: .../manual-replication-faq`):
- Tables need a **primary key**.
- `UPDATE`/`DELETE` only carry the full old row if `REPLICA IDENTITY FULL` is set.
- Large TOAST-ed `text`/`jsonb`/`bytea` values may arrive as "unchanged" markers.
- Airbyte does not clear WAL on each sync — add an hourly heartbeat table to avoid WAL bloat.

### 3.4 Batch extract (Wrappers + cron)

`source: supabase: guides/database/extensions/wrappers/overview` — schedule a `pg_cron`
job that `INSERT … SELECT`s into a foreign table mapped to your warehouse. Simple, SQL-only,
no extra pipeline infra. Good for nightly rollups; not for low-latency sync.

### 3.5 Logs out

`source: supabase: guides/platform/log-drains` — stream logs (not table data) to
**Amazon S3**, Datadog, etc. Billed on drain hours + events + egress.

---

## 4. Read external data without moving it (query-in-place)

Foreign Data Wrappers (FDW) make external systems look like local tables; data stays remote.

- **S3** (`source: supabase-wrappers: catalog/s3`): read **CSV / JSON Lines / Parquet** from
  S3 (and S3-compatible: R2, Wasabi, Supabase Storage's own S3 endpoint). Supports gzip/bzip2/
  xz/zlib. **Read-only** (Select ✅; Insert/Update/Delete ❌). No query pushdown — large scans
  transfer the whole object; compressed Parquet loads fully into memory. Needs
  `s3:GetObject`/`s3:GetObjectAttributes`.
- **Warehouses / DBs** (`source: supabase-wrappers: catalog/{bigquery,clickhouse,snowflake,…}`):
  query the remote system live and join it against your own tables ("QETL").
- **Analytics buckets / Iceberg** (`source: supabase: guides/storage/analytics/query-with-postgres`):
  query Parquet/Iceberg over S3-compatible analytics buckets.

This is the lowest-friction way to "use AWS data in Supabase" when you don't actually need
the data resident — no pipeline, always current, only pull what you need (saves egress).

---

## 5. Cost & considerations

- **Egress** (`source: supabase: guides/platform/manage-your-usage/egress`): data leaving
  Supabase is billed per GB past a 250 GB free quota. Every data-out path incurs it; the
  query-in-place "pull only what you need" model minimizes it.
- **Connection routing** (`source: supabase: guides/database/connecting-to-postgres`): use the
  **direct connection** (IPv6, or IPv4 add-on) for `pg_dump`, migrations, and replication —
  not the pooler.
- **Sizes**: in-bound dashboard import caps at 100 MB; everything larger goes via pgloader /
  `COPY` / dump-restore / logical replication.

---

## 6. TL;DR for the "moving data in and out of AWS" question

| Job | Answer |
|---|---|
| One-time move **into** Supabase | `import-data` (by size) or `migrating-to-supabase/postgres` |
| Migrate **off RDS** | pgloader (MySQL/MSSQL) or Postgres dump/logical-replication; RDS-side export in `aws-rds` |
| Continuous sync **out to AWS** | **No managed path.** Self-managed logical replication via **AWS DMS** (`manual-replication-setup` + `aws-dms`) |
| Land data in **Redshift / S3** | AWS DMS target, or Redshift `COPY`/`UNLOAD` (`aws-redshift`), or AWS Glue (`aws-glue`) |
| **Read** S3/AWS data in Supabase | S3 Wrapper (read-only) or Iceberg FDW — no copy |
| Reduce read load (no export) | Read replica |

**The honest line for an enterprise customer:** *"We don't offer a managed AWS
replication destination yet — managed external replication targets BigQuery. For AWS, the
supported pattern is self-managed logical replication via AWS DMS (it replicates schema
changes and is ideal when your infra is already in AWS), or query-in-place via the S3
Wrapper if you only need to read. Here's the exact setup."* Then point at
`manual-replication-setup` + the AWS DMS user guide.

---

### Sources referenced (all mirrored on docs.erfi.io)

`supabase`, `supabase-etl`, `supabase-wrappers`, `supabase-cli`, `postgrest`, `pgloader`,
`aws-dms`, `aws-rds`, `aws-aurora`, `aws-redshift`, `aws-glue`, `aws-kinesis`,
`aws-s3`, `postgres`.

*This is a synthesis artifact for internal enablement — not official Supabase documentation.
It documents the supported pattern for AWS data movement; it does not imply a managed AWS
destination exists.*
