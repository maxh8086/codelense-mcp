// Creates a small SQLite demo database (customers/orders/items) for trying the ERD tab.
import { DatabaseSync } from 'node:sqlite';

const file = process.argv[2] ?? 'demo-erd.db';
const db = new DatabaseSync(file);
db.exec(`
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, title TEXT, price REAL);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), placed_at TEXT);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER
);
`);
db.close();
console.log(`created ${file}`);
