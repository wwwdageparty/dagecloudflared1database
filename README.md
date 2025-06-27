🌐 [English Version](README_EN.md)   |   🇨🇳 [中文版本](README_CN.md)

# Dage D1 Cloudflare Worker API

A Cloudflare Worker providing a REST API for managing and querying D1 database tables.

---

## Authentication

All endpoints require an `Authorization` header:

```
Authorization: Bearer <TOKEN>
```

- `WRITE_TOKEN` grants full read/write access including table management  
- `READ_ONLY_TOKEN` grants read-only GET access only

---

## API Overview

Base path: `/api`

---

## General

### `GET /api`

Welcome message.

```json
{
  "code": 0,
  "message": null,
  "data": {
    "message": "Welcome to the D1 API!"
  }
}
```

---

## Table Management

### List Tables

`GET /api/tables`

Permission: Read (`READ_ONLY_TOKEN` or `WRITE_TOKEN`)

Response example:

```json
{
  "code": 0,
  "data": {
    "tables": ["table1", "table2"]
  }
}
```

---

### Create Table

`POST /api/create-table`

Permission: Write (`WRITE_TOKEN`)

Request JSON body:

```json
{
  "tableName": "your_table_name",
  "c1Unique": false // Optional, default false
}
```

Response:

```json
{
  "code": 0,
  "message": "Table 'your_table_name' created successfully with initial data.",
  "data": {
    "results": [...]
  }
}
```

Note: Reserved IDs 1 and 100 for system use; user data starts from ID 101.

---

### Drop Table

`DELETE /api/tables/:tableName`

Permission: Write

Response:

```json
{
  "code": 0,
  "message": "Table 'example' dropped successfully.",
  "data": { ... }
}
```

---

### Drop Index

`DELETE /api/:tableName/index/:indexName`

Permission: Write

---

## Metadata Endpoints

### Count Records

`GET /api/:tableName/count?min_id=&max_id=`

Permission: Read

Response example:

```json
{
  "code": 0,
  "data": {
    "count": 42
  }
}
```

---

### Get Max ID

`GET /api/:tableName/max_id`

Permission: Read

Response example:

```json
{
  "code": 0,
  "data": {
    "max_id": 123
  }
}
```

---

## Records CRUD

### List Records

`GET /api/:tableName/records`

Permission: Read

Supports query parameters:

- `id` (via `/records/:id`) — fetch by primary key  
- `c1` — filter by c1 value  
- `min_id`, `max_id` — filter by ID range  
- `limit`, `offset` — pagination

Response example:

```json
{
  "code": 0,
  "data": [
    { "id": 101, "c1": "...", ... }
  ]
}
```

---

### Create Record

`POST /api/:tableName/records`

Permission: Write

Request body: JSON object matching table columns

Response example:

```json
{
  "code": 0,
  "message": "Record created successfully",
  "data": {
    "id": 104
  }
}
```

---

### Get Record by ID

`GET /api/:tableName/records/:id`

Permission: Read

---

### Update Record

`PUT /api/:tableName/records/:id`

Permission: Write

Request body: JSON object with updated fields

---

### Delete Record

`DELETE /api/:tableName/records/:id`

Permission: Write

---

## Error Response

All errors return:

```json
{
  "code": 1,
  "message": "Error description",
  "data": {
    "details": "Optional detailed error info"
  }
}
```

---

# Notes

- `c1Unique` defaults to `false` (no UNIQUE constraint on `c1`).  
- IDs 1 and 100 are reserved internally; user data starts at 101.

---

# Setup

- Set environment variables:

```
WRITE_TOKEN=your_write_token
READ_ONLY_TOKEN=your_read_only_token
```

- Bind your D1 database in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "your_db_name"
database_id = "your_db_id"
```

