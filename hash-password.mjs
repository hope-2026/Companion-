import crypto from 'crypto';

const password = process.argv.slice(2).join(' ');

if (!password) {
  console.error('Usage: node hash-password.mjs "your portal password"');
  process.exit(1);
}

console.log(crypto.createHash('sha256').update(password).digest('hex'));
