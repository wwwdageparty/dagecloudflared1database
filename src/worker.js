/**
 * 📦 Dage.Party Cloudflare Worker for D1 Database Read/Write API
 * --------------------------------------------------------------
 * Author: www.dage.party
 *
 * This Cloudflare Worker provides a RESTful API to interact with a D1 database.
 *
 * 🔧 Features:
 * - Create (insert) new records
 * - Read records by ID, specific column (c1), or fetch all
 * - Update existing records
 * - Delete records by ID
 * - Programmatically create tables with a fixed schema
 * - List all tables in the database
 * - List records with optional `min_id`, `limit`, and `offset`
 * - Drop (delete) entire tables
 * - Count records with optional `min_id` and `max_id` filters
 * - Retrieve the maximum `id` value from a table
 *
 * 📦 API Response Format:
 * {
 *   "code": 0,        // 0 = success, non-zero = error
 *   "message": "",    // Descriptive message (error or success)
 *   "data": {}        // Payload for successful operations
 * }
 *
 * 🔐 Authorization:
 * - All requests must include an Authorization header: `Authorization: Bearer <TOKEN>`
 * - Two token types:
 *     WRITE_TOKEN       → Required for all write and admin operations (create, update, delete, etc.)
 *     READ_ONLY_TOKEN   → Allows read-only access to GET endpoints
 *
 * ⚠️ Setup Required:
 * - Define these in your environment settings (e.g., `.env`, Wrangler Dashboard, or `wrangler.toml`):
 *     WRITE_TOKEN=your-write-token
 *     READ_ONLY_TOKEN=your-read-token
 *
 * - Bind your D1 database to the `DB` binding in `wrangler.toml`:
 *     [[d1_databases]]
 *     binding = "DB"
 *     database_name = "your_database_name"
 *     database_id = "your_database_id"
 *
 */


const DB_VERSION = 1;


/**
 * Helper function to send a standardized JSON response.
 * @param {number} code - The status code (0 for success, non-zero for error).
 * @param {string | null} [message=null] - An optional message, typically for errors.
 * @param {any | null} [data=null] - The actual data or results of the operation.
 * @param {number} [httpStatus=200] - The HTTP status code to send (e.g., 200 OK, 400 Bad Request).
 * @returns {Response} A new Response object with the standardized JSON body.
 */
function jsonResponse(code, message = null, data = null, httpStatus = 200) {
  const responseBody = {
    code: code,
  };

  if (message !== null) {
    responseBody.message = message;
  }
  if (data !== null) {
    responseBody.data = data;
  }

  return new Response(JSON.stringify(responseBody), {
    headers: { 'Content-Type': 'application/json' },
    status: httpStatus,
  });
}

/**
 * Authenticates the request based on the Authorization header.
 * @param {Request} request - The incoming HTTP request.
 * @param {Env} env - The environment variables (containing the tokens).
 * @returns {{isAuthenticated: boolean, canWrite: boolean, canRead: boolean, message: string}}
 * An object indicating authentication status and permissions.
 */
function authenticateRequest(request, env) {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { isAuthenticated: false, canWrite: false, canRead: false, message: 'Authentication required: Missing or malformed Authorization header.' };
  }

  const token = authHeader.substring(7);

  const WRITE_TOKEN = env.WRITE_TOKEN;
  const READ_ONLY_TOKEN = env.READ_ONLY_TOKEN;

  if (token === WRITE_TOKEN) {
    return { isAuthenticated: true, canWrite: true, canRead: true, message: 'Authenticated with write access.' };
  } else if (token === READ_ONLY_TOKEN) {
    return { isAuthenticated: true, canWrite: false, canRead: true, message: 'Authenticated with read-only access.' };
  } else {
    return { isAuthenticated: false, canWrite: false, canRead: false, message: 'Invalid authentication token.' };
  }
}

/**
 * Creates a new table with a predefined schema in the D1 database.
 * Applies a UNIQUE constraint to the `c1` column if specified.
 *
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to create.
 * @param {boolean} c1Unique - Whether the `c1` column should be marked as UNIQUE.
 * @returns {Promise<D1Result[]>} - An array of results from each SQL operation.
 */
async function createTable(db, tableName, c1Unique = false) {
  try {
    const c1Constraint = c1Unique ? 'UNIQUE' : '';

    const tableSchema = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        c1 VARCHAR(255) ${c1Constraint},
        c2 VARCHAR(255),
        c3 VARCHAR(255),
        i1 INT,
        i2 INT,
        i3 INT,
        d1 DOUBLE,
        d2 DOUBLE,
        d3 DOUBLE,
        t1 TEXT,
        t2 TEXT,
        t3 TEXT,
        v1 TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        v2 TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        v3 TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Always create index unless `c1` is already UNIQUE
    const indexSchema = !c1Unique
      ? `CREATE INDEX IF NOT EXISTS idx_${tableName}_c1 ON ${tableName}(c1);`
      : null;

    const newUuid = crypto.randomUUID();

    // Insert reserved record for tracking DB version (id = 1)
    const versionInsertQuery = `
      INSERT INTO ${tableName} (id, c1, c2, i1, d1)
      VALUES (1, '___basic_db_version', ?, ?, ?);
    `;

    // Insert reserved record for system use (id = 100)
    const systemReserveInsertQuery = `
      INSERT INTO ${tableName} (id, c1) VALUES (100, '___systemReserve');
    `;

    // ℹ️ User data should start from ID 101 and up
    const queries = [{ sql: tableSchema }];

    if (indexSchema) {
      queries.push({ sql: indexSchema });
    }

    queries.push(
      { sql: versionInsertQuery, params: [newUuid, DB_VERSION, DB_VERSION] },
      { sql: systemReserveInsertQuery }
    );

    const results = [];

    for (const q of queries) {
      const statement = q.params ? db.prepare(q.sql).bind(...q.params) : db.prepare(q.sql);
      const result = await statement.run();
      results.push(result);
    }

    return results;
  } catch (error) {
    console.error(`Error creating table ${tableName}:`, error);
    throw new Error(`Failed to create table: ${error.message}`);
  }
}


/**
 * Inserts a new record into the specified table.
 *
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to insert into.
 * @param {object} data - An object containing the data for the new record.
 * Only include the columns you wish to set.
 * @returns {Promise<D1Result>} The result of the insert operation.
 */
async function insertRecord(db, tableName, data) {
  try {
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(col => data[col]);

    if (columns.length === 0) {
      throw new Error('No data provided for insertion.');
    }

    const query = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES (${placeholders});
    `;

    const result = await db.prepare(query).bind(...values).run();

    return result;
  } catch (error) {
    console.error('Error inserting record:', error);
    throw new Error(`Failed to insert record: ${error.message}`);
  }
}

/**
 * Fetches all records from the specified table.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to fetch from.
 * @returns {Promise<Array<object>>} An array of all records.
 */
async function getAllRecords(db, tableName) {
  try {
    const query = `SELECT * FROM ${tableName};`;
    const { results } = await db.prepare(query).all();
    return results;
  } catch (error) {
    console.error(`Error fetching all records from table ${tableName}:`, error);
    throw new Error(`Failed to fetch all records: ${error.message}`);
  }
}

/**
 * Fetches a single record by its ID.
 * Returns an array, which will be empty if not found, or contain one object if found.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to fetch from.
 * @param {number} id - The ID of the record to fetch.
 * @returns {Promise<Array<object>>} An array containing the record object, or an empty array.
 */
async function getRecordById(db, tableName, id) {
  try {
    const query = `SELECT * FROM ${tableName} WHERE id = ?;`;
    const { results } = await db.prepare(query).bind(id).all();
    return results; // Always return the results array
  } catch (error) {
    console.error(`Error fetching record by ID ${id} from table ${tableName}:`, error);
    throw new Error(`Failed to fetch record by ID: ${error.message}`);
  }
}

/**
 * Fetches records by the value of column 'c1'.
 * Utilizes the index on c1 for efficient lookup.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to fetch from.
 * @param {string} c1Value - The value of 'c1' to search for.
 * @returns {Promise<Array<object>>} An array of matching records.
 */
async function getRecordsByC1(db, tableName, c1Value) {
  try {
    const query = `SELECT * FROM ${tableName} WHERE c1 = ?;`;
    const { results } = await db.prepare(query).bind(c1Value).all();
    return results;
  } catch (error) {
    console.error(`Error fetching records by c1 value ${c1Value} from table ${tableName}:`, error);
    throw new Error(`Failed to fetch records by c1: ${error.message}`);
  }
}

/**
 * Fetches records from the specified table with optional filtering, limiting, and offsetting.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to fetch from.
 * @param {object} [options={}] - An object containing optional query parameters.
 * @param {number} [options.minId] - Minimum ID value (id > minId).
 * @param {number} [options.maxId] - Maximum ID value (id < maxId).
 * @param {number} [options.limit] - Maximum number of records to return.
 * @param {number} [options.offset] - Number of records to skip.
 * @returns {Promise<Array<object>>} An array of matching records.
 */
async function getRecordsWithOptions(db, tableName, options = {}) {
  try {
    let query = `SELECT * FROM ${tableName}`;
    const params = [];
    const conditions = [];

    if (options.minId !== undefined && options.minId !== null) {
      conditions.push(`id > ?`);
      params.push(options.minId);
    }
    if (options.maxId !== undefined && options.maxId !== null) {
      conditions.push(`id < ?`);
      params.push(options.maxId);
    }
    // Add other conditions here if needed (e.g., c1_value)

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY id ASC`; // Ensure consistent ordering for pagination

    if (options.limit !== undefined && options.limit !== null) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    if (options.offset !== undefined && options.offset !== null) {
      query += ` OFFSET ?`;
      params.push(options.offset);
    }

    const { results } = await db.prepare(query).bind(...params).all();
    return results;
  } catch (error) {
    console.error(`Error fetching records from table ${tableName} with options:`, error);
    throw new Error(`Failed to fetch records with options: ${error.message}`);
  }
}

/**
 * Updates an existing record by its ID.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to update.
 * @param {number} id - The ID of the record to update.
 * @param {object} updates - An object containing key-value pairs for fields to update.
 * @returns {Promise<D1Result>} The result of the update operation.
 */
async function updateRecord(db, tableName, id, updates) {
  try {
    const setClauses = [];
    const bindValues = [];

    for (const key in updates) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        setClauses.push(`${key} = ?`);
        bindValues.push(updates[key]);
      }
    }

    if (setClauses.length === 0) {
      throw new Error('No fields provided for update.');
    }

    const query = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?;`;
    bindValues.push(id);

    const result = await db.prepare(query).bind(...bindValues).run();
    return result;
  }
   catch (error) {
    console.error(`Error updating record ID ${id} in table ${tableName}:`, error);
    throw new Error(`Failed to update record: ${error.message}`);
  }
}

/**
 * Deletes a record by its ID.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to delete from.
 * @param {number} id - The ID of the record to delete.
 * @returns {Promise<D1Result>} The result of the delete operation.
 */
async function deleteRecord(db, tableName, id) {
  try {
    const query = `DELETE FROM ${tableName} WHERE id = ?;`;
    const result = await db.prepare(query).bind(id).run();
    return result;
  } catch (error) {
    console.error(`Error deleting record ID ${id} from table ${tableName}:`, error);
    throw new Error(`Failed to delete record: ${error.message}`);
  }
}

/**
 * Lists all user-defined tables in the D1 database.
 * @param {D1Database} db - The D1 database instance.
 * @returns {Promise<string[]>} An array of table names.
 */
async function listTables(db) {
  try {
    // Query sqlite_master to get user-defined table names
    const query = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'cf_%';`;
    const { results } = await db.prepare(query).all();
    // Extract just the table names from the results
    return results.map(row => row.name);
  } catch (error) {
    console.error('Error listing tables:', error);
    throw new Error(`Failed to list tables: ${error.message}`);
  }
}

/**
 * Drops (deletes) a table from the database.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to drop.
 * @returns {Promise<D1Result>} The result of the drop operation.
 */
async function dropTable(db, tableName) {
  try {
    const query = `DROP TABLE IF EXISTS ${tableName};`;
    const result = await db.prepare(query).run();
    return result;
  } catch (error) {
    console.error(`Error dropping table ${tableName}:`, error);
    throw new Error(`Failed to drop table: ${error.message}`);
  }
}

/**
 * Counts the number of records in a table with optional min_id and max_id filters.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to count from.
 * @param {object} [options={}] - An object containing optional query parameters.
 * @param {number} [options.minId] - Minimum ID value (id > minId).
 * @param {number} [options.maxId] - Maximum ID value (id < maxId).
 * @returns {Promise<number>} The count of matching records.
 */
async function countRecords(db, tableName, options = {}) {
  try {
    let query = `SELECT COUNT(id) AS count FROM ${tableName}`;
    const params = [];
    const conditions = [];

    if (options.minId !== undefined && options.minId !== null) {
      conditions.push(`id > ?`);
      params.push(options.minId);
    }
    if (options.maxId !== undefined && options.maxId !== null) {
      conditions.push(`id < ?`);
      params.push(options.maxId);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    const { results } = await db.prepare(query).bind(...params).all();
    return results.length > 0 ? results[0].count : 0;
  } catch (error) {
    console.error(`Error counting records from table ${tableName} with options:`, error);
    throw new Error(`Failed to count records: ${error.message}`);
  }
}

/**
 * Gets the maximum ID from a specified table.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table to query.
 * @returns {Promise<number | null>} The maximum ID, or null if the table is empty.
 */
async function getMaxId(db, tableName) {
  try {
    const query = `SELECT MAX(id) AS max_id FROM ${tableName};`;
    const { results } = await db.prepare(query).all();
    // D1 returns results as an array of objects.
    // If the table is empty, MAX(id) returns null.
    return results.length > 0 && results[0].max_id !== null ? results[0].max_id : null;
  } catch (error) {
    console.error(`Error getting max ID from table ${tableName}:`, error);
    throw new Error(`Failed to get max ID: ${error.message}`);
  }
}


/**
 * Drops a specific index from a table.
 * @param {D1Database} db - The D1 database instance.
 * @param {string} tableName - The name of the table the index belongs to.
 * @param {string} indexName - The name of the index to drop.
 * @returns {Promise<D1Result>} The result of the drop index operation.
 */
async function dropIndex(db, tableName, indexName) {
  try {
    // SQLite's DROP INDEX syntax does not explicitly reference the table name in the ON clause,
    // but typically indexes are uniquely named within a database.
    // It's good practice to ensure the index exists before trying to drop it.
    const query = `DROP INDEX IF EXISTS ${indexName};`;
    const result = await db.prepare(query).run();
    return result;
  } catch (error) {
    console.error(`Error dropping index ${indexName} from table ${tableName}:`, error);
    throw new Error(`Failed to drop index: ${error.message}`);
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(segment => segment);
    const method = request.method;

    // Ensure the D1 binding is available
    if (!env.DB) {
      return jsonResponse(1, 'D1 database binding not found.', null, 500);
    }

    // Authenticate the request first, passing the env object
    const auth = authenticateRequest(request, env);

    if (!auth.isAuthenticated) {
      // Return 401 Unauthorized for missing or invalid token
      return jsonResponse(1, auth.message, null, 401);
    }

    const API_PREFIX = 'api';

    // Check if the request starts with the API prefix
    if (pathSegments[0] !== API_PREFIX) {
        return jsonResponse(0, null, { message: 'Welcome to the D1 API!' }, 200);
    }

    // --- Table Management Endpoints ---

    // Handle /api/tables endpoint (List Tables)
    if (pathSegments[1] === 'tables' && method === 'GET' && pathSegments.length === 2) {
      if (!auth.canRead) {
        return jsonResponse(1, 'Forbidden: Read access required to list tables.', null, 403);
      }
      try {
        const tables = await listTables(env.DB);
        return jsonResponse(0, null, { tables: tables });
      } catch (error) {
        console.error('Error in /api/tables endpoint:', error);
        return jsonResponse(1, 'Internal server error while listing tables.', { details: error.message }, 500);
      }
    }

    // Handle /api/tables/:tableName endpoint (Drop Table)
    if (pathSegments[1] === 'tables' && method === 'DELETE' && pathSegments.length === 3) {
      if (!auth.canWrite) {
        return jsonResponse(1, 'Forbidden: Write access required to drop tables.', null, 403);
      }
      const tableNameToDrop = pathSegments[2];
      if (!tableNameToDrop) {
        return jsonResponse(1, 'Table name is required to drop a table.', null, 400);
      }
      try {
        const dropResult = await dropTable(env.DB, tableNameToDrop);
        if (dropResult.success) {
          return jsonResponse(0, null, { message: `Table '${tableNameToDrop}' dropped successfully.`, results: dropResult });
        } else {
          return jsonResponse(1, 'Failed to drop table.', { details: dropResult.error }, 500);
        }
      } catch (error) {
        console.error('Error in /api/tables/:tableName endpoint:', error);
        return jsonResponse(1, 'Internal server error during table drop.', { details: error.message }, 500);
      }
    }

    // Handle table creation endpoint: /api/create-table
    if (pathSegments[1] === 'create-table' && method === 'POST') {
      if (!auth.canWrite) {
        return jsonResponse(1, 'Forbidden: Write access required to create tables.', null, 403);
      }
      try {
        const { tableName, c1Unique } = await request.json();
        if (!tableName) {
          return jsonResponse(1, 'tableName is required.', null, 400);
        }
        const createResult = await createTable(env.DB, tableName, c1Unique);
        if (createResult.every(r => r.success)) {
          return jsonResponse(0, null, { message: `Table '${tableName}' created successfully with initial data.`, results: createResult }, 201);
        } else {
          return jsonResponse(1, 'Failed to create table or insert initial data. Some operations failed.', createResult, 500);
        }
      } catch (error) {
        console.error('Error in create-table endpoint:', error);
        return jsonResponse(1, 'Internal server error during table creation.', { details: error.message }, 500);
      }
    }

    // --- Data CRUD & Querying Endpoints ---

    // For CRUD operations, the path should be like /api/:tableName/records or /api/:tableName/records/:id
    // or /api/:tableName/count or /api/:tableName/max_id
    const tableName = pathSegments[1]; // The table name is the second segment after 'api'
    const resource = pathSegments[2];   // 'records', 'count', or 'max_id'
    const id = pathSegments[3] ? parseInt(pathSegments[3]) : null; // ID if present for /records/:id

    if (!tableName || (resource !== 'records' && resource !== 'count' && resource !== 'max_id')) {
        return jsonResponse(1, 'Invalid API path. Expected /api/:tableName/records, /api/create-table, /api/tables, /api/:tableName/count, or /api/:tableName/max_id.', null, 404);
    }

    // Handle /api/:tableName/count endpoint
    if (resource === 'count' && method === 'GET') {
      if (!auth.canRead) {
        return jsonResponse(1, 'Forbidden: Read access required to count records.', null, 403);
      }
      try {
        const minId = url.searchParams.has('min_id') ? parseInt(url.searchParams.get('min_id')) : undefined;
        const maxId = url.searchParams.has('max_id') ? parseInt(url.searchParams.get('max_id')) : undefined; // This maxId is for filtering, not the function call
        const count = await countRecords(env.DB, tableName, { minId, maxId });
        return jsonResponse(0, null, { count: count });
      } catch (error) {
        console.error(`Error in /api/${tableName}/count endpoint:`, error);
        return jsonResponse(1, 'Internal server error while counting records.', { details: error.message }, 500);
      }
    }

    // Handle /api/:tableName/max_id endpoint
    if (resource === 'max_id' && method === 'GET') {
      if (!auth.canRead) {
        return jsonResponse(1, 'Forbidden: Read access required to get max ID.', null, 403);
      }
      try {
        const maxIdValue = await getMaxId(env.DB, tableName);
        return jsonResponse(0, null, { max_id: maxIdValue });
      } catch (error) {
        console.error(`Error in /api/${tableName}/max_id endpoint:`, error);
        return jsonResponse(1, 'Internal server error while getting max ID.', { details: error.message }, 500);
      }
    }

    // Handle /api/:tableName/index/:indexName endpoint (Drop Index)
    if (resource === 'index' && method === 'DELETE' && pathSegments.length === 4) {
      if (!auth.canWrite) {
        return jsonResponse(1, 'Forbidden: Write access required to drop indexes.', null, 403);
      }
      const indexName = pathSegments[3];
      if (!indexName) {
        return jsonResponse(1, 'Index name is required to drop an index.', null, 400);
      }
      try {
        const dropIndexResult = await dropIndex(env.DB, tableName, indexName);
        if (dropIndexResult.success) {
          return jsonResponse(0, null, { message: `Index '${indexName}' from table '${tableName}' dropped successfully.`, results: dropIndexResult });
        } else {
          return jsonResponse(1, 'Failed to drop index.', { details: dropIndexResult.error }, 500);
        }
      } catch (error) {
        console.error(`Error in /api/${tableName}/index/${indexName} endpoint:`, error);
        return jsonResponse(1, 'Internal server error during index drop.', { details: error.message }, 500);
      }
    }

    // If resource is 'records', proceed with CRUD
    if (resource === 'records') {
        switch (method) {
            case 'POST': // Insert
                if (!auth.canWrite) {
                    return jsonResponse(1, 'Forbidden: Write access required to insert records.', null, 403);
                }
                const newData = await request.json();
                const insertResult = await insertRecord(env.DB, tableName, newData);
                if (insertResult.success) {
                    return jsonResponse(0, null, { message: 'Record created successfully', id: insertResult.meta.last_row_id }, 201);
                } else {
                    return jsonResponse(1, 'Failed to create record', { details: insertResult.error }, 500);
                }

            case 'GET': // Read
                if (!auth.canRead) {
                    return jsonResponse(1, 'Forbidden: Read access required.', null, 403);
                }
                if (id) {
                    const records = await getRecordById(env.DB, tableName, id); // Returns an array
                    if (records.length > 0) {
                        return jsonResponse(0, null, records);
                    } else {
                        return jsonResponse(1, 'Record not found.', [], 404); // Return empty array in data for consistency
                    }
                } else if (url.searchParams.has('c1')) {
                    const c1Value = url.searchParams.get('c1');
                    const records = await getRecordsByC1(env.DB, tableName, c1Value);
                    return jsonResponse(0, null, records);
                } else {
                    // Handle requests with min_id, limit, offset, or no parameters
                    const minId = url.searchParams.has('min_id') ? parseInt(url.searchParams.get('min_id')) : undefined;
                    const maxIdParam = url.searchParams.has('max_id') ? parseInt(url.searchParams.get('max_id')) : undefined; // This maxId is for filtering records
                    const limit = url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')) : undefined;
                    const offset = url.searchParams.has('offset') ? parseInt(url.searchParams.get('offset')) : undefined;

                    if (minId !== undefined || maxIdParam !== undefined || limit !== undefined || offset !== undefined) {
                        const records = await getRecordsWithOptions(env.DB, tableName, { minId, maxId: maxIdParam, limit, offset });
                        return jsonResponse(0, null, records);
                    } else {
                        // If no specific ID, c1, or new options, return all records
                        const allRecords = await getAllRecords(env.DB, tableName);
                        return jsonResponse(0, null, allRecords);
                    }
                }

            case 'PUT': // Update
                if (!auth.canWrite) {
                    return jsonResponse(1, 'Forbidden: Write access required to update records.', null, 403);
                }
                if (!id) {
                    return jsonResponse(1, 'Record ID is required for update.', null, 400);
                }
                const updateData = await request.json();
                const updateResult = await updateRecord(env.DB, tableName, id, updateData);
                if (updateResult.success) {
                    return jsonResponse(0, null, { message: 'Record updated successfully', changes: updateResult.meta.changes });
                } else {
                    return jsonResponse(1, 'Failed to update record', { details: updateResult.error }, 500);
                }

            case 'DELETE': // Delete
                if (!auth.canWrite) {
                    return jsonResponse(1, 'Forbidden: Write access required to delete records.', null, 403);
                }
                if (!id) {
                    return jsonResponse(1, 'Record ID is required for delete.', null, 400);
                }
                const deleteResult = await deleteRecord(env.DB, tableName, id);
                if (deleteResult.success) {
                    if (deleteResult.meta.changes > 0) {
                        return jsonResponse(0, null, { message: 'Record deleted successfully' });
                    } else {
                        return jsonResponse(1, 'Record not found or already deleted.', null, 404);
                    }
                } else {
                    return jsonResponse(1, 'Failed to delete record', { details: deleteResult.error }, 500);
                }

            default:
                return jsonResponse(1, 'Method not allowed.', null, 405);
        }
    }

    return jsonResponse(1, 'Invalid API path.', null, 404);
  },
};