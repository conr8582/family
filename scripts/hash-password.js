// Usage: node scripts/hash-password.js
// Prompts for a password and prints the bcrypt hash to copy into APP_PASSWORD_HASH in .env
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Password: ', async (password) => {
  rl.close();
  if (!password) { console.error('No password entered.'); process.exit(1); }
  const hash = await bcrypt.hash(password, 12);
  console.log('\nAdd this to your .env:\n');
  console.log(`APP_PASSWORD_HASH=${hash}`);
});
