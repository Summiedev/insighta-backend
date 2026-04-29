const fs = require('fs');

const authFile = 'C:\\Users\\Sumayyah\\Desktop\\project\\HNGTASK1\\src\\middleware\\auth.js';
let content = fs.readFileSync(authFile, 'utf8');

// Find and show what we have around that error message
const errorIdx = content.indexOf('Auth: User not found for token sub=');
if (errorIdx > 0) {
  console.log('Found error message at position', errorIdx);
  console.log('Context:', JSON.stringify(content.substring(errorIdx - 50, errorIdx + 100)));
}

// Use simpler pattern - just find and replace the error message line
const oldError = `console.error(\`Auth: User not found for token sub=\${payload.sub}\`);`;
const newError = `console.error('[AUTH] ❌ USER_LOOKUP_FAILED - no user with id:', payload.sub);`;

if (content.includes(oldError)) {
  content = content.replace(oldError, newError);
  console.log('✅ Error message updated');
} else {
  console.log('⚠️ Could not find exact error message');
}

// Add logging before user lookup
const beforeLookup = `const user = await db.collection('users').findOne({ id: payload.sub }`;
const newBeforeLookup = `console.log('[AUTH] 🔍 Looking up user with id:', payload.sub);\n        const user = await db.collection('users').findOne({ id: payload.sub }`;

if (content.includes(beforeLookup)) {
  content = content.replace(beforeLookup, newBeforeLookup);
  console.log('✅ User lookup logging added');
}

// Add logging for token verification
const tokenFail = `if (!payload) {\n          return unauthorized(res);`;
const newTokenFail = `if (!payload) {\n          console.error('[AUTH] ❌ TOKEN_VERIFICATION_FAILED - invalid signature or expired');\n          return unauthorized(res);`;

if (content.includes(tokenFail)) {
  content = content.replace(tokenFail, newTokenFail);
  console.log('✅ Token verification logging added');
}

fs.writeFileSync(authFile, content);
console.log('\n✅ All logging injected successfully!');
console.log('Next: Start backend and run whoami to see logs');
