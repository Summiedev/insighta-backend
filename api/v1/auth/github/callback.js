const { getDb } = require('../../../../src/db');
const { setCors, utcNow } = require('../../../../src/helpers');
const { uuidv7 } = require('../../../../src/uuidv7');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../../../src/middleware/observability');
const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  buildAuthSetCookieHeaders,
  createAccessToken,
  exchangeGithubCodeForToken,
  fetchGithubPrimaryEmail,
  fetchGithubUser,
  generateRefreshToken,
  getAuthConfig,
  hashRefreshToken,
  hashState,
  resolveUserRole,
  utcDatePlusSeconds,
} = require('../../../../src/auth');

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  if (!code || !state) {
    return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (err) {
    console.error('GET /api/v1/auth/github/callback configuration error:', err);
    return res.status(500).json({ status: 'error', message: 'Auth service misconfigured' });
  }

  try {
    const db = await getDb();
    const authStates = db.collection('auth_states');
    const users = db.collection('users');
    const refreshTokens = db.collection('refresh_tokens');

    const stateHash = hashState(state, config.tokenHashSecret);
    const stateDoc = await authStates.findOne({ state_hash: stateHash });
    if (!stateDoc) {
      return res.status(400).json({ status: 'error', message: 'Invalid state' });
    }

    if (!stateDoc.expires_at || new Date(stateDoc.expires_at).getTime() <= Date.now()) {
      await authStates.deleteOne({ _id: stateDoc._id });
      return res.status(400).json({ status: 'error', message: 'State expired' });
    }

    await authStates.deleteOne({ _id: stateDoc._id });

    const githubAccessToken = await exchangeGithubCodeForToken(config, code, stateDoc.code_verifier, stateDoc.redirect_uri);
    const githubProfile = await fetchGithubUser(githubAccessToken);
    const primaryEmail = await fetchGithubPrimaryEmail(githubAccessToken);

    const githubId = String(githubProfile.id || '');
    const username = String(githubProfile.login || '').trim();
    if (!githubId || !username) {
      return res.status(502).json({ status: 'error', message: 'Invalid GitHub profile data' });
    }

    const existingUser = await users.findOne({ github_id: githubId });
    const role = resolveUserRole(config, githubProfile, existingUser ? existingUser.role : null);
    const userEmail = primaryEmail || githubProfile.email || null;

    const now = utcNow();

    if (!existingUser) {
      await users.insertOne({
        id: uuidv7(),
        github_id: githubId,
        username,
        email: userEmail,
        avatar_url: githubProfile.avatar_url || null,
        role,
        is_active: true,
        last_login_at: now,
        created_at: utcNow(),
      });
    } else {
      await users.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            username,
            email: userEmail,
            avatar_url: githubProfile.avatar_url || existingUser.avatar_url || null,
            role,
            is_active: existingUser.is_active !== false,
            last_login_at: now,
          },
        }
      );
    }

    const user = await users.findOne({ github_id: githubId });
    if (!user) {
      return res.status(500).json({ status: 'error', message: 'Unable to create user session' });
    }

    const accessToken = createAccessToken(user, config);
    const refreshToken = generateRefreshToken();

    await refreshTokens.insertOne({
      id: uuidv7(),
      user_id: user.id,
      hashed_refresh_token: hashRefreshToken(refreshToken, config.tokenHashSecret),
      expires_at: utcDatePlusSeconds(REFRESH_TOKEN_TTL_SECONDS),
      revoked: false,
      created_at: utcNow(),
    });

    const cliMode = stateDoc.client_mode === 'cli';
    if (cliMode) {
      return res.status(200).json({
        status: 'success',
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
        user: {
          id: user.id,
          github_id: user.github_id,
          username: user.username,
          email: user.email,
          avatar_url: user.avatar_url || null,
          role: user.role,
          is_active: user.is_active !== false,
          last_login_at: user.last_login_at || null,
          created_at: user.created_at,
        },
      });
    }

    res.setHeader('Set-Cookie', buildAuthSetCookieHeaders(accessToken, refreshToken, config));

    return res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user.id,
          github_id: user.github_id,
          username: user.username,
          email: user.email,
          avatar_url: user.avatar_url || null,
          role: user.role,
          is_active: user.is_active !== false,
          last_login_at: user.last_login_at || null,
          created_at: user.created_at,
        },
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
      },
    });
  } catch (err) {
    console.error('GET /api/v1/auth/github/callback error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = applyObservability(handler, {
  routeId: 'GET /api/v1/auth/github/callback',
  policy: RATE_LIMIT_POLICIES.authStrict,
});