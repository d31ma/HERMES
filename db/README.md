# db/

This folder is the database layer for CADUCEUS.

## Layout

```text
db/
├── schemas/       # Versioned FYLO/CHEX schemas, developer-owned
├── seed/          # Human-editable seed documents, developer-owned
└── collections/   # FYLO-managed storage, do not hand-edit
```

## schemas/

Each collection uses FYLO's versioned schema layout:

```text
db/schemas/<collection>/
├── manifest.json
└── history/
    └── v1.json
```

The files in `history/` are CHEX regex schemas. Each leaf schema value is a regex string. The `id`, `createdAt`, and `updatedAt` fields are managed by FYLO and omitted from schemas.

## seed/

Seed files live at:

```text
db/seed/<collection>/<document-id>.json
```

## collections/

`db/collections/` is owned by FYLO. Do not modify files under this directory by hand.
