require('dotenv').config();
const crypto = require('crypto');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMTlkZDQ1MS0zNzczLTdjYmUtYmRjYS1lNmZlMzFlZWFlMTUiLCJnaXRodWJfaWQiOiI2NDg5NjcyNiIsInVzZXJuYW1lIjoiU3VtbWllZGV2Iiwicm9sZSI6ImFuYWx5c3QiLCJpYXQiOjE3Nzc0NTYzMTcsImV4cCI6MTc3NzQ1NjkxNywiaXNzIjoiaW5zaWdodGEtbGFicy1hcGkifQ.6EyWIs0saNwZT7pED20ELcUq0lflXpzL_K_5DNVal5M';
const [headerEncoded, payloadEncoded, signatureEncoded] = token.split('.');

const secret = process.env.JWT_ACCESS_SECRET;
console.log('Secret:', secret.substring(0, 20) + '...');

const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(`${headerEncoded}.${payloadEncoded}`)
  .digest('base64url');

console.log('Expected signature:', expectedSignature);
console.log('Actual signature:  ', signatureEncoded);
console.log('Signatures match:', expectedSignature === signatureEncoded);

// Also check expiry
const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString());
const now = Math.floor(Date.now() / 1000);
console.log('\nToken expiry check:');
console.log('Current time (sec):', now);
console.log('Token exp (sec):  ', payload.exp);
console.log('Token expired:', now >= payload.exp);
console.log('Time remaining:', payload.exp - now, 'seconds');
