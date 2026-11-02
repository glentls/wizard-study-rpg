/** Usage: npm run promote-admin -w server -- someone@example.com */
import { loadEnv } from '../config/env.js';
import { openDatabase, run } from '../db/database.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run promote-admin -w server -- <email>');
  process.exit(1);
}
const db = openDatabase(loadEnv().dbPath);
const result = run(db, "UPDATE accounts SET role = 'admin' WHERE email = ? AND status = 'active'", email.toLowerCase());
console.log(result.changes === 1 ? `${email} is now an administrator.` : `No active account found for ${email}.`);
db.close();
