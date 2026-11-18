/* eslint-disable */
require("dotenv").config({ quiet: true });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL.replace(/\/postgres$/, "/restaurant") });
  for (const sql of process.argv.slice(2)) {
    const r = await p.query(sql);
    console.log(JSON.stringify(r.rows));
  }
  await p.end();
})();
