const fs = require('fs');
const path = require('path');

const authFile = 'C:\\Users\\Sumayyah\\Desktop\\project\\HNGTASK1\\src\\middleware\\auth.js';
let content = fs.readFileSync(authFile, 'utf8');

// Add logging after token verification failure check
content = content.replace(
  `const payload = verifyAccessToken(token, config);
      if (!payload) {
        return unauthorized(res);
      }`,
  `const payload = verifyAccessToken(token, config);
      if (!payload) {
        console.error('[AUTH] ❌ TOKEN VERIFICATION FAILED');
        return unauthorized(res);
      }
      console.log('[AUTH] ✅ Token verified');`
);

// Add logging before user lookup
content = content.replace(
  `const db = await getDb();
      const user = await db.collection('users').findOne({ id: payload.sub },`,
  `const db = await getDb();
      console.log('[AUTH] Looking up user with ID:', payload.sub);
      const user = await db.collection('users').findOne({ id: payload.sub },`
);

// Update error message for user not found
content = content.replace(
  `if (!user) {
        console.error(\`Auth: User not found for token sub=\${payload.sub}\`);
        return unauthorized(res);
      }`,
  `if (!user) {
        console.error('[AUTH] ❌ USER NOT FOUND for ID:', payload.sub);
        return unauthorized(res);
      }
      console.log('[AUTH] ✅ User found:', user.username);`
);

fs.writeFileSync(authFile, content);
console.log('✅ Logging injected into auth middleware');
