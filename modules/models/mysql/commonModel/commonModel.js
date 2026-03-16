// models/CommonModel.js
import db from '../../../../config/knex.js';

const CommonModel = {
  // Generic SELECT with optional conditions, ordering, grouping, and having
  async getData(
    table,
    select = "*",
    condition = "",
    orderBy = "",
    order = "",
    groupBy = "",
    having = "",
    trx = null
  ) {
    const knex = trx || db;
    let query = knex(table).select(knex.raw(select));

    if (condition) {
      query = query.whereRaw(condition);
    }

    if (orderBy && order) {
      query = query.orderBy(orderBy, order);
    }

    if (groupBy) {
      query = query.groupBy(groupBy);
    }

    if (having) {
      query = query.havingRaw(having);
    }
    // console.log(query.toString());


    const result = await query;
    return result.length ? result : false;
  },

  // Select with LIMIT and OFFSET
  async getDataLimit(
    table,
    select = "*",
    condition = "",
    orderBy = "",
    order = "",
    limit = 0,
    offset = 0,
    trx = null
  ) {
    const knex = trx || db;
    let query = knex(table).select(knex.raw(select));

    if (condition) {
      query = query.whereRaw(condition);
    }

    if (orderBy && order) {
      query = query.orderBy(orderBy, order);
    }

    if (limit) {
      query = query.limit(limit).offset(offset || 0);
    }

    // console.log(query.toString());

    const result = await query;
    return result.length ? result : false;
  },

  // Select with LIMIT, OFFSET and BINDINGS
  async getDataWithBindings(
    table,
    select = "*",
    condition = "",
    bindings = [],
    orderBy = "",
    order = "",
    limit = 0,
    offset = 0,
    trx = null
  ) {
    const knex = trx || db;
    let query = knex(table).select(knex.raw(select));

    if (condition) {
      query = query.whereRaw(condition, bindings);
    }

    if (orderBy) {
      if (order) {
        query = query.orderBy(orderBy, order);
      } else {
        query = query.orderByRaw(orderBy);
      }
    }

    if (limit) {
      query = query.limit(limit).offset(offset || 0);
    }

    // console.log(query.toString());

    const result = await query;
    return result.length ? result : false;
  },

  async arrayFormation(array, label) {
    const output = {};
    if (!Array.isArray(array)) return output;

    array.forEach((item) => {
      if (!output[item[label]]) output[item[label]] = [];
      output[item[label]].push(item);
    });

    return output;
  },

  async arrayFormationStdClass(array, label) {
    const output = {};
    array.forEach((item) => {
      if (!output[item[label]]) output[item[label]] = [];
      output[item[label]].push(item);
    });
    return output;
  },

  async arrayFormationWithChecked(array, label, assignedSet = new Set()) {
    const output = {};
    if (!Array.isArray(array)) return output;

    array.forEach((item) => {
      const moduleKey = item[label] || 'default';

      // normalize id to number for comparison
      const permId = (typeof item.id === 'string' && /^\d+$/.test(item.id)) ? Number(item.id) : item.id;

      // clone the object to avoid mutating original records (optional)
      const permWithChecked = { ...item, checked: assignedSet.has(Number(permId)) };

      if (!output[moduleKey]) output[moduleKey] = [];
      output[moduleKey].push(permWithChecked);
    });

    return output;
  },

  async fetch(
    table,
    columns = "*",
    condition = "1=1",
    sortBy = {},
    groupBy = "",
    limit = {},
    trx = null
  ) {
    const knex = trx || db;
    const query = knex.select(knex.raw(columns)).from(table).whereRaw(condition);

    if (groupBy) query.groupBy(groupBy);

    Object.entries(sortBy).forEach(([key, value]) => {
      query.orderBy(key, value);
      // query.orderByRaw(`${key} ${value.toUpperCase()}`);
    });

    if (limit.offset != null && limit.rows != null) {
      query.offset(limit.offset).limit(limit.rows);
    }

    return await query;
  },

  async joinFetch(
    mainTable,
    joinTables = [],
    condition = "1=1",
    sortBy = "",
    groupBy = "",
    limit = {},
    trx = null,
    having = ""
  ) {

    // console.log("joinFetch called with:"+ JSON.stringify(limit));
    // return false;
    const knex = trx || db;
    const [table, columnsArr] = mainTable;
    // if columnsArr is empty, select * from main table
    const selectCols = (Array.isArray(columnsArr) && columnsArr.length) ? columnsArr.join(" , ") : " * ";

    let query = knex.select(knex.raw(selectCols)).from(table);

    joinTables.forEach(([joinType, joinTable, joinOn, joinColumns]) => {
      // use raw join for full control (keeps your previous behavior)
      query = query.joinRaw(`${joinType} join ${joinTable} on (${joinOn})`);
      if (joinColumns) {
        joinColumns.forEach((col) => query.select(knex.raw(col)));
      }
    });
    // query.whereRaw(condition);
    let conditionSql = condition;
    let conditionBindings = [];

    if (condition && typeof condition === 'object' && condition.sql) {
      conditionSql = condition.sql;
      conditionBindings = Array.isArray(condition.bindings) ? condition.bindings : [];
    }

    query.whereRaw(conditionSql, conditionBindings);

    // if (groupBy) query.groupBy(groupBy);
    if (groupBy) {
      if (Array.isArray(groupBy)) {
        query.groupBy(...groupBy);
      } else {
        query.groupBy(groupBy);
      }
    }
    if (sortBy && typeof sortBy === "object" && sortBy.raw) {
      query.orderByRaw(sortBy.raw);
    } else if (sortBy && typeof sortBy === "object") {
      Object.entries(sortBy).forEach(([key, value]) => {
        // If key looks like a SQL expression (CASE WHEN ... END or contains spaces/parens), use orderByRaw
        if (/\bCASE\b|\(|\)|\s/.test(key) && !/^\w+(\.\w+)?$/.test(key)) {
          query.orderByRaw(`${key} ${value.toUpperCase()}`);
        } else {
          query.orderBy(key, value);
        }
      });
    } else {
      if (sortBy) {
        query.orderBy(sortBy);
      }
    }

    if(having) {
      query.havingRaw(having);
    }

    if (limit.offset != null && limit.rows != null) {
      query.offset(limit.offset).limit(limit.rows);
    }

    // debug: comment out in production
    console.log(query.toSQL().toNative());
    return await query;
  },

  /**
   * insertData: returns inserted id (or insert result)
   * Accepts optional trx
   */
  async insertData(table, data, trx = null) {
    const knex = trx || db;

    // Bulk insert array
    if (Array.isArray(data)) {
      const res = await knex(table).insert(data);
      return res || false;
    }

    // Try Postgres-style returning first, fall back to basic insert
    try {
      // some dialects support returning(), others (mysql) will throw
      const res = await knex(table).insert(data).returning('id');
      // res could be [id] or numeric depending on client - normalize
      if (Array.isArray(res)) return res[0] || false;
      return res || false;
    } catch (e) {
      // fallback for MySQL or dialects that don't support returning()
      const res = await knex(table).insert(data);
      // knex for MySQL returns insert id (number) or [id] depending on setup
      if (Array.isArray(res)) return res[0] || false;
      return res[0] || false;
    }
  },

  /**
   * updateData returns true if rows affected > 0 (keeps parity with your previous impl)
   */
  async updateData(table, data, condition, trx = null) {
    const knex = trx || db;
    const updated = await knex(table).whereRaw(condition).update(data);
    return updated > 0;
  },

  async deleteRecord(table, condition, trx = null) {
    const knex = trx || db;
    try {
      // ensure table exists before attempting delete to avoid ER_NO_SUCH_TABLE
      const tableExists = await db.schema.hasTable(table);
      if (!tableExists) {
        console.warn(`deleteRecord: table ${table} does not exist, skipping delete.`);
        return false;
      }
    } catch (err) {
      // if schema check fails for any reason, log and proceed to attempt delete (fallback)
      console.warn(`deleteRecord: table existence check failed for ${table}:`, err);
    }

    const deleted = await knex(table).whereRaw(condition).del();
    return deleted > 0;
  },

  async getEnum(table, field, trx = null) {
    const knex = trx || db;
    const result = await knex.raw(`SHOW COLUMNS FROM \`${table}\` LIKE '${field}'`);
    // For mysql returns result[0][0].Type
    const rowType = result[0][0].Type;
    const matches = rowType.match(/'([^']+)'/g);
    return matches ? matches.map((m) => m.replace(/'/g, "")) : [];
  },

  /**
   * mysqlFetchRow accepts either a promise (query) or a direct array of rows.
   * type: "array" returns rows array, "object" returns array of objects, "assoc" returns first row
   */
  async mysqlFetchRow(resultPromiseOrRows, type = "assoc") {
    const rows = Array.isArray(resultPromiseOrRows)
      ? resultPromiseOrRows
      : await resultPromiseOrRows;

    if (!rows || !rows.length) return false;

    switch (type) {
      case "array":
        return rows;
      case "object":
        return rows.map((row) => ({ ...row }));
      case "assoc":
      default:
        return rows[0];
    }
  },


};

export default CommonModel;
