🌐 [English Version](README_EN.md)   |   🇨🇳 [中文版本](README_CN.md)

# DAGE D1 Cloudflare Worker API

一个 Cloudflare Worker，提供用于管理和查询 D1 数据库表的 REST API。

---

## 授权

所有接口都需要 `Authorization` 请求头：

```
Authorization: Bearer <TOKEN>
```

- `WRITE_TOKEN` 授予完全的读写权限，包括表管理  
- `READ_ONLY_TOKEN` 授予只读权限（仅限 GET 请求）

---

## API 概览

基础路径: `/api`

---

## 通用接口

### `GET /api`

欢迎信息。

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

## 表管理

### 列出所有表

`GET /api/tables`

权限: 读取 (`READ_ONLY_TOKEN` 或 `WRITE_TOKEN`)

响应示例:

```json
{
  "code": 0,
  "data": {
    "tables": ["table1", "table2"]
  }
}
```

---

### 创建新表

`POST /api/create-table`

权限: 写入 (`WRITE_TOKEN`)

请求体 JSON:

```json
{
  "tableName": "your_table_name",
  "c1Unique": false // 可选，默认 false
}
```

响应:

```json
{
  "code": 0,
  "message": "表 'your_table_name' 创建成功，包含初始数据。",
  "data": {
    "results": [...]
  }
}
```

备注:  
预留 ID 1 和 100 给系统内部使用，用户数据从 ID 101 开始。

---

### 删除表

`DELETE /api/tables/:tableName`

权限: 写入

响应:

```json
{
  "code": 0,
  "message": "表 'example' 删除成功。",
  "data": { ... }
}
```

---

### 删除索引

`DELETE /api/:tableName/index/:indexName`

权限: 写入

---

## 元数据接口

### 统计记录数

`GET /api/:tableName/count?min_id=&max_id=`

权限: 读取

响应示例:

```json
{
  "code": 0,
  "data": {
    "count": 42
  }
}
```

---

### 获取最大 ID

`GET /api/:tableName/max_id`

权限: 读取

响应示例:

```json
{
  "code": 0,
  "data": {
    "max_id": 123
  }
}
```

---

## 记录增删改查

### 列出记录

`GET /api/:tableName/records`

权限: 读取

支持查询参数:

- `id` (通过 `/records/:id`) — 按主键查询  
- `c1` — 按 c1 字段过滤  
- `min_id`, `max_id` — ID 范围过滤  
- `limit`, `offset` — 分页

响应示例:

```json
{
  "code": 0,
  "data": [
    { "id": 101, "c1": "...", ... }
  ]
}
```

---

### 新建记录

`POST /api/:tableName/records`

权限: 写入

请求体: 与表结构对应的 JSON 对象

响应示例:

```json
{
  "code": 0,
  "message": "记录创建成功",
  "data": {
    "id": 104
  }
}
```

---

### 按ID查询记录

`GET /api/:tableName/records/:id`

权限: 读取

---

### 更新记录

`PUT /api/:tableName/records/:id`

权限: 写入

请求体: 包含更新字段的 JSON 对象

---

### 删除记录

`DELETE /api/:tableName/records/:id`

权限: 写入

---

## 错误响应格式

所有错误统一返回：

```json
{
  "code": 1,
  "message": "错误描述",
  "data": {
    "details": "可选的详细错误信息"
  }
}
```

---

# 说明

- `c1Unique` 默认值为 `false`，表示不对 `c1` 字段设置 UNIQUE 约束。  
- 预留 ID 1 和 100 用于系统内部，用户数据从 ID 101 开始。  

---

# 开发环境

- 设置环境变量：

```
WRITE_TOKEN=your_write_token
READ_ONLY_TOKEN=your_read_only_token
```

- 在 `wrangler.toml` 中绑定 D1 数据库：

```toml
[[d1_databases]]
binding = "DB"
database_name = "your_db_name"
database_id = "your_db_id"
```

