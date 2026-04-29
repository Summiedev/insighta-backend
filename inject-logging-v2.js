const fs = require('fs');

const authFile = 'C:\\Users\\Sumayyah\\Desktop\\project\\HNGTASK1\\src\\middleware\\auth.js';
let content = fs.readFileSync(authFile, 'utf8');

// Replace token verification failure check
const tokenCheckOld = `      const payload = verifyAccessToken(token, config);
      if (!payload) {
        return unauthorized(res);
      }`;

const tokenCheckNew = `      const payload = verifyAccessToken(token, config);
      if (!payload) {
        console.error('[AUTH] TOKEN_VERIFICATION_FAILED - signature or expiry invalid');
        return unauthorized(res);
      }`;

if (content.includes(tokenCheckOld)) {
  content = content.replace(tokenCheckOld, tokenCheckNew);
  console.log('✅ Token verification logging added');
} else {
  console.log('⚠️ Could not find token check pattern');
}

// Replace user lookup section
const userLookupOld = `      const db = await getDb();
      const user = await db.collection('users').findOne({ id: payload.sub }, { projection: { _id: 0 } });

      if (!user) {
        console.error(\`Auth: User not found for token sub=\${payload.sub}\`);
        return unauthorized(res);
      }`;

const userLookupNew = `      const db = await getDb();
      console.log('[AUTH] Token payload.sub:', payload.sub);
      const user = await db.collection('users').findOne({ id: payload.sub }, { projection: { _id: 0 } });

      if (!user) {
        console.error('[AUTH] USER_NOT_FOUND - no user with id:', payload.sub);
        return unauthorized(res);
      }`;

if (content.includes(userLookupOld)) {
  content = content.replace(userLookupOld, userLookupNew);
  console.log('✅ User lookup logging added');
} else {
  console.log('⚠️ Could not find user lookup pattern');
}

fs.writeFileSync(authFile, content);
console.log('✅ All logging injected successfully');
