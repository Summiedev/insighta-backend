const crypto = require('crypto');
const { getDb } = require('./db');
const { setCors, utcNow, formatProfile, requireApiVersion, buildPaginationLinks } = require('./helpers');
const { uuidv7 } = require('./uuidv7');
const { applyObservability, RATE_LIMIT_POLICIES } = require('./middleware/observability');
const { protect } = require('./middleware/auth');
const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  STATE_TTL_SECONDS,
  buildAuthSetCookieHeaders,
  buildClearAuthCookieHeaders,
  buildGithubAuthorizeUrl,
  createAccessToken,
  exchangeGithubCodeForToken,
  fetchGithubPrimaryEmail,
  fetchGithubUser,
  generatePkcePair,
  generateRefreshToken,
  generateState,
  getAuthConfig,
  hashRefreshToken,
  hashState,
  parseCookies,
  parseJsonBody,
  resolveUserRole,
  utcDatePlusSeconds,
} = require('./auth');
const { parseNL } = require('./nlParser');
const { buildQuery } = require('./queryBuilder');
const { createProfileFromName } = require('./profileCreator');
const { createProfilesExportCursor } = require('./profilesQuery');

const HEADERS = ['id', 'name', 'gender', 'gender_probability', 'age', 'age_group', 'country_id', 'country_name', 'country_probability', 'created_at'];

function json(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
}

function getPathname(req) {
  return new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
}

function isPath(pathname, candidate) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const normalizedCandidate = candidate.replace(/\/+$/, '') || '/';
  return normalized === normalizedCandidate;
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function writeLine(res, line) {
  const ok = res.write(line);
  if (ok) return;
  await new Promise((resolve) => res.once('drain', resolve));
}

function makePaginationResponse(req, page, limit, total, rows, fallbackPath) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    status: 'success',
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    total_pages: totalPages,
    links: buildPaginationLinks(req, Number(page), Number(limit), Number(total), fallbackPath),
    data: rows.map(formatProfile),
  };
}

async function healthHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  try {
    const db = await getDb();
    const count = await db.collection('profiles').countDocuments();
    return json(res, 200, {
      status: 'ok',
      profiles: count,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health check database error:', err);
    const payload = {
      status: 'error',
      message: 'Database unavailable',
    };
    if (process.env.NODE_ENV !== 'production') {
      payload.details = err.message;
    }
    return json(res, 500, payload);
  }
}

async function seedHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  const COUNTRY_POOL = [
    ['NG','Nigeria'],['GH','Ghana'],['KE','Kenya'],['ZA','South Africa'],['ET','Ethiopia'],['UG','Uganda'],['TZ','Tanzania'],['CM','Cameroon'],['SN','Senegal'],['AO','Angola'],['CI','Ivory Coast'],['ZM','Zambia'],['ZW','Zimbabwe'],['RW','Rwanda'],['ML','Mali'],['BJ','Benin'],['TG','Togo'],['NE','Niger'],['EG','Egypt'],['MA','Morocco'],['DZ','Algeria'],['SD','Sudan'],['SO','Somalia'],['MZ','Mozambique'],['MG','Madagascar'],['MW','Malawi'],['BW','Botswana'],['NA','Namibia'],['GA','Gabon'],['CG','Congo'],['CD','DR Congo'],['BI','Burundi'],['GN','Guinea'],['SL','Sierra Leone'],['LR','Liberia'],['BF','Burkina Faso'],['GM','Gambia'],['TD','Chad'],['LY','Libya'],['TN','Tunisia'],['ER','Eritrea'],['DJ','Djibouti'],['SS','South Sudan'],['CF','Central African Republic'],['US','United States'],['GB','United Kingdom'],['FR','France'],['DE','Germany'],['IN','India'],['BR','Brazil'],['CA','Canada'],['AU','Australia'],
  ];
  const MALE_FIRST = ['Emeka','Chidi','Babatunde','Segun','Femi','Tunde','Kola','Dele','Wale','Gbenga','Kwame','Kofi','Yaw','Ato','Kamau','Waweru','Otieno','Mwangi','Sipho','Themba','Bongani','Nhlanhla','Abebe','Tesfaye','Dawit','Amara','Oumar','Ibrahima','Mamadou','Seydou','Cheikh','Modou','Ismaila','Moussa','Bakary','Adama','Boubacar','Jean-Pierre','Emmanuel','Innocent','Samuel','Felix','Eric','Michael','David','Peter','John','Joseph','Ahmed','Mohamed','Yusuf','Omar','Ali','Mustafa','Khalid','Idris','Hassan','Rodrigo','Carlos','Jorge','Antonio','Pedro','Tariq','Rachid','Karim','Nabil','James','Robert','Francis','Geoffrey','Anthony','Luc','Herve','Didier','Serge','Victor','Marcel','Franck','Benjamin','Thabo','Lucky','Sello','Idrissa','Rasmane','Landry','Mathias','Issa','Salou','Soumana','Garba','Hamid','Yakubu','Musa','Sani','Bello','Alpha','Lamin','Momodou','Ebrima','William','Richard','Daniel','Isaac','Henri','Claude','Gerald','Pascal','Freddy','Elvis','Lazarus','Alfred','Stanley','Adeola','Rotimi','Kunle','Niyi','Dotun','Tosin','Biodun','Demola','Jide','Remi','Tendai','Farai','Simba','Alassane','Drissa','Fousseni','Julius','Charles','Leonard','Vincent','Nicholas','Oliver','Jonas','Thomas','Nicolas','Pierre','Antoine','Marco','Luca','Alessandro','Davide','Rajan','Arjun','Vikram','Suresh','Anil','Hiroshi','Kenji','Takeshi','Gabriel','Lucas','Diego','Rafael','Mateus','Vitor','Bruno','Thiago','Igor'];
  const FEMALE_FIRST = ['Ngozi','Chioma','Adaeze','Amaka','Ifunanya','Bisi','Yetunde','Folake','Sade','Lara','Abena','Ama','Efua','Akua','Adwoa','Wanjiru','Njeri','Aisha','Grace','Faith','Zanele','Nomvula','Thandi','Lindiwe','Nombuso','Tigist','Meron','Selam','Hana','Sara','Fatoumata','Mariama','Kadiatou','Aissata','Bintou','Fatou','Awa','Rokhaya','Sokhna','Yacine','Rokiatou','Ramata','Kadija','Salimata','Consolata','Odette','Vestine','Monica','Sandra','Barbara','Josephine','Mary','Rose','Esther','Catherine','Charity','Hodan','Faadumo','Sahra','Hawa','Fatima','Amina','Luisa','Maria','Sofia','Isabel','Claudia','Zineb','Hafsa','Nadia','Imane','Alice','Ruth','Susan','Leah','Doris','Sylvie','Christiane','Jocelyne','Celine','Brigitte','Ines','Chantal','Beatrice','Therese','Madeleine','Portia','Dineo','Palesa','Refilwe','Mariam','Rasmata','Veronique','Aminata','Rabi','Zainab','Hadiza','Maryam','Hauwa','Isatou','Binta','Helena','Patricia','Agnes','Florence','Victoria','Laetitia','Angeline','Fanny','Odile','Marie-Claire','Denise','Jacqueline','Evelyn','Bertha','Judith','Martha','Lilian','Titilola','Gbemisola','Olawunmi','Omowumi','Abimbola','Oluwatosin','Olabisi','Oladunni','Olajumoke','Oluwakemi','Rudo','Chiedza','Tatenda','Tsitsi','Tariro','Niamato','Djenabou','Giulia','Francesca','Chiara','Valentina','Emma','Mia','Laura','Anna','Lena','Marie','Sophie','Camille','Chloe','Olivia','Ava','Sophia','Isabella','Priya','Divya','Anjali','Kavita','Sakura','Ana','Beatriz','Julia','Camila','Larissa','Leticia','Natalia','Fernanda'];
  const LAST_NAMES = ['Okafor','Nwosu','Adeyemi','Afolabi','Okonkwo','Balogun','Adeola','Fashola','Ogundipe','Mensah','Asante','Boateng','Owusu','Njoroge','Kariuki','Ochieng','Kimani','Dlamini','Nkosi','Zulu','Mthembu','Ndlovu','Girma','Haile','Bekele','Tekle','Diallo','Bah','Sow','Camara','Keita','Mbaye','Fall','Diop','Seck','Traore','Coulibaly','Kone','Sylla','Toure','Habimana','Niyonzima','Ndayishimiye','Osei','Antwi','Asare','Acheampong','Mwamba','Banda','Phiri','Tembo','Hassan','Ibrahim','Abdi','Farah','Elhaj','Nour','Osman','Silva','Mendes','Fernandes','Lopes','Benali','Amrani','Belkacem','Mansouri','Mwangi','Otieno','Kamau','Ngugi','Mbarga','Nganou','Fotso','Manga','Kouassi','Brou','Yao','Molefe','Mokoena','Sithole','Ouedraogo','Zongo','Sawadogo','Kabore','Mahamadou','Harouna','Djibo','Suleiman','Abubakar','Abdullahi','Garba','Ceesay','Jallow','Saine','Quansah','Darko','Tetteh','Amoah','Ngoma','Massamba','Luba','Ndongo','Mutombo','Kabongo','Chakwera','Mhango','Manda','Martins','Adegoke','Oduya','Falodun','Lawal','Ogunleye','Adebayo','Olawale','Mutasa','Moyo','Gumbo','Diarra','Sangare','Diabate','Dembele','Conde','Soumah','Benson','Adeyinka','Adegbola','Omondi','Achieng','Oloo','Armah','Ababio','Ofori','Rossi','Ferrari','Schmidt','Weber','Martin','Bernard','Dubois','Simon','Wilson','Johnson','Davis','Brown','Miller','Patel','Sharma','Singh','Kumar','Tanaka','Suzuki','Watanabe','Santos','Oliveira','Alves','Costa','Ferreira','Lima','Pereira'];

  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function randFloat(a, b) { return Math.round((Math.random() * (b - a) + a) * 100) / 100; }
  function classifyAge(age) { if (age <= 12) return 'child'; if (age <= 17) return 'teenager'; if (age <= 64) return 'adult'; return 'senior'; }
  function randomAge() { const r = Math.random(); if (r < 0.07) return randInt(0, 12); if (r < 0.14) return randInt(13, 17); if (r < 0.82) return randInt(18, 64); return randInt(65, 90); }

  function buildProfiles() {
    const used = new Set();
    const profiles = [];
    function makeName(first) {
      for (let i = 0; i < 20; i++) {
        const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
        const name = `${first} ${last}`;
        if (!used.has(name.toLowerCase())) return name;
      }
      let i = 2;
      const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      while (used.has(`${first} ${last} ${i}`.toLowerCase())) i++;
      return `${first} ${last} ${i}`;
    }
    function pickCountry() {
      const [country_id, country_name] = COUNTRY_POOL[Math.floor(Math.random() * COUNTRY_POOL.length)];
      return { country_id, country_name };
    }
    const shuffledMale = [...MALE_FIRST].sort(() => Math.random() - 0.5);
    const shuffledFemale = [...FEMALE_FIRST].sort(() => Math.random() - 0.5);

    for (let i = 0; i < 1013; i++) {
      const first = shuffledMale[i % shuffledMale.length];
      const name = makeName(first);
      used.add(name.toLowerCase());
      const age = randomAge();
      const { country_id, country_name } = pickCountry();
      profiles.push({ name, gender: 'male', gender_probability: randFloat(0.60, 0.99), age, age_group: classifyAge(age), country_id, country_name, country_probability: randFloat(0.05, 0.95) });
    }
    for (let i = 0; i < 1013; i++) {
      const first = shuffledFemale[i % shuffledFemale.length];
      const name = makeName(first);
      used.add(name.toLowerCase());
      const age = randomAge();
      const { country_id, country_name } = pickCountry();
      profiles.push({ name, gender: 'female', gender_probability: randFloat(0.60, 0.99), age, age_group: classifyAge(age), country_id, country_name, country_probability: randFloat(0.05, 0.95) });
    }
    return profiles;
  }

  try {
    const db = await getDb();
    const col = db.collection('profiles');
    const profiles = buildProfiles();
    const ops = profiles.map((p) => ({
      insertOne: {
        document: {
          id: uuidv7(),
          name: p.name,
          gender: p.gender,
          gender_probability: p.gender_probability,
          age: p.age,
          age_group: p.age_group,
          country_id: p.country_id,
          country_name: p.country_name,
          country_probability: p.country_probability,
          created_at: utcNow(),
        },
      },
    }));

    let inserted = 0;
    let skipped = 0;
    try {
      const result = await col.bulkWrite(ops, { ordered: false });
      inserted = result.insertedCount;
      skipped = profiles.length - inserted;
    } catch (err) {
      if (err.result) {
        inserted = err.result.nInserted || 0;
        skipped = profiles.length - inserted;
      } else {
        throw err;
      }
    }

    const total = await col.countDocuments();
    return json(res, 200, { status: 'success', inserted, skipped, total });
  } catch (err) {
    console.error('POST /api/seed error:', err);
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}

async function githubLoginHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (err) {
    console.error('GET /api/v1/auth/github/login configuration error:', err);
    return json(res, 500, { status: 'error', message: 'Auth service misconfigured' });
  }

  const clientMode = String(req.query.client || req.query.mode || 'browser').toLowerCase() === 'cli' ? 'cli' : 'browser';
  const cliRedirectUri = String(req.query.redirect_uri || req.query.redirectUri || '').trim();
  if (clientMode === 'cli' && cliRedirectUri && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/(callback|api\/auth\/github\/callback|api\/auth\/callback\/github)\/?$/i.test(cliRedirectUri)) {
    return json(res, 400, { status: 'error', message: 'Invalid query parameters' });
  }

  const suppliedState = String(req.query.state || '').trim();
  const suppliedCodeVerifier = String(req.query.code_verifier || '').trim();
  const suppliedCodeChallenge = String(req.query.code_challenge || '').trim();

  const generatedPkce = generatePkcePair();
  const state = suppliedState || generateState();
  const codeVerifier = suppliedCodeVerifier || generatedPkce.codeVerifier;
  const codeChallenge = suppliedCodeChallenge || (suppliedCodeVerifier ? crypto.createHash('sha256').update(suppliedCodeVerifier).digest('base64url') : generatedPkce.codeChallenge);
  const stateHash = hashState(state, config.tokenHashSecret);
  const redirectUri = clientMode === 'cli'
    ? (cliRedirectUri || config.githubRedirectUri)
    : (() => {
        const proto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'] || 'http').split(',')[0].trim();
        const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${process.env.PORT || 3000}`;
        const origin = host.startsWith('localhost') || host.includes(':') ? `${proto}://${host}` : `${proto}://${host}`;
        return `${origin.replace(/\/$/, '')}/api/auth/github/callback`;
      })();

  try {
    const db = await getDb();
    await db.collection('auth_states').insertOne({
      id: uuidv7(),
      state_hash: stateHash,
      code_verifier: codeVerifier,
      client_mode: clientMode,
      redirect_uri: redirectUri,
      created_at: utcNow(),
      expires_at: utcDatePlusSeconds(STATE_TTL_SECONDS),
    });

    const authorizeUrl = buildGithubAuthorizeUrl({ ...config, githubRedirectUri: redirectUri }, state, codeChallenge);
    if (clientMode === 'cli') {
      return json(res, 200, { status: 'success', data: { authorization_url: authorizeUrl, state, expires_in: STATE_TTL_SECONDS } });
    }

    res.setHeader('Location', authorizeUrl);
    return res.status(302).end();
  } catch (err) {
    console.error('GET /api/v1/auth/github/login error:', err);
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}

async function githubCallbackHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  if (!code || !state) {
    return json(res, 400, { status: 'error', message: 'Invalid query parameters' });
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (err) {
    console.error('GET /api/v1/auth/github/callback configuration error:', err);
    return json(res, 500, { status: 'error', message: 'Auth service misconfigured' });
  }

  try {
    const db = await getDb();
    const authStates = db.collection('auth_states');
    const users = db.collection('users');
    const refreshTokens = db.collection('refresh_tokens');

    const stateHash = hashState(state, config.tokenHashSecret);
    const stateDoc = await authStates.findOne({ state_hash: stateHash });
    if (!stateDoc) {
      return json(res, 400, { status: 'error', message: 'Invalid state' });
    }

    if (!stateDoc.expires_at || new Date(stateDoc.expires_at).getTime() <= Date.now()) {
      await authStates.deleteOne({ _id: stateDoc._id });
      return json(res, 400, { status: 'error', message: 'State expired' });
    }

    await authStates.deleteOne({ _id: stateDoc._id });

    const githubAccessToken = await exchangeGithubCodeForToken(config, code, stateDoc.code_verifier, stateDoc.redirect_uri);
    const githubProfile = await fetchGithubUser(githubAccessToken);
    const primaryEmail = await fetchGithubPrimaryEmail(githubAccessToken);

    const githubId = String(githubProfile.id || '');
    const username = String(githubProfile.login || '').trim();
    if (!githubId || !username) {
      return json(res, 502, { status: 'error', message: 'Invalid GitHub profile data' });
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
      return json(res, 500, { status: 'error', message: 'Unable to create user session' });
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
      return json(res, 200, {
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
    return json(res, 200, {
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
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}

const authMeHandler = protect(
  applyObservability(async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') {
      return json(res, 405, { status: 'error', message: 'Method not allowed' });
    }
    return json(res, 200, { status: 'success', data: req.auth.user });
  }, { routeId: 'GET /api/auth/me', policy: RATE_LIMIT_POLICIES.queryStandard }),
  ['analyst', 'admin']
);

const authRefreshHandler = applyObservability(async (req, res) => {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (err) {
    console.error('POST /api/v1/auth/refresh configuration error:', err);
    return json(res, 500, { status: 'error', message: 'Auth service misconfigured' });
  }

  try {
    const body = await parseJsonBody(req);
    const cookies = parseCookies(req);
    const cookieRefreshToken = cookies.refresh_token || '';
    const bodyRefreshToken = body && typeof body.refresh_token === 'string' ? body.refresh_token : '';
    const presentedRefreshToken = (cookieRefreshToken || bodyRefreshToken || '').trim();

    if (!presentedRefreshToken) {
      return json(res, 400, { status: 'error', message: 'Refresh token required' });
    }

    const isCli = Boolean(bodyRefreshToken) || String(req.headers['x-auth-client'] || '').toLowerCase() === 'cli';
    const db = await getDb();
    const refreshTokens = db.collection('refresh_tokens');
    const users = db.collection('users');

    const tokenHash = hashRefreshToken(presentedRefreshToken, config.tokenHashSecret);
    const tokenDoc = await refreshTokens.findOne({ hashed_refresh_token: tokenHash });
    if (!tokenDoc) {
      if (!isCli) res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
      return json(res, 401, { status: 'error', message: 'Invalid refresh token' });
    }

    const now = Date.now();
    const isExpired = !tokenDoc.expires_at || new Date(tokenDoc.expires_at).getTime() <= now;
    if (tokenDoc.revoked || isExpired) {
      if (tokenDoc.user_id) {
        await refreshTokens.updateMany(
          { user_id: tokenDoc.user_id, revoked: false },
          { $set: { revoked: true, revoked_at: utcNow(), revoke_reason: tokenDoc.revoked ? 'reuse_detected' : 'expired' } }
        );
      }
      if (!isCli) res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
      return json(res, 401, { status: 'error', message: tokenDoc.revoked ? 'Refresh token reuse detected' : 'Refresh token expired' });
    }

    const user = await users.findOne({ id: tokenDoc.user_id });
    if (!user) {
      await refreshTokens.updateOne({ _id: tokenDoc._id }, { $set: { revoked: true, revoked_at: utcNow(), revoke_reason: 'user_missing' } });
      if (!isCli) res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
      return json(res, 401, { status: 'error', message: 'Invalid refresh token' });
    }

    await refreshTokens.updateOne({ _id: tokenDoc._id }, { $set: { revoked: true, revoked_at: utcNow(), revoke_reason: 'rotated' } });

    const nextRefreshToken = generateRefreshToken();
    await refreshTokens.insertOne({
      id: uuidv7(),
      user_id: user.id,
      hashed_refresh_token: hashRefreshToken(nextRefreshToken, config.tokenHashSecret),
      expires_at: utcDatePlusSeconds(REFRESH_TOKEN_TTL_SECONDS),
      revoked: false,
      created_at: utcNow(),
    });

    const nextAccessToken = createAccessToken(user, config);
    if (isCli) {
      return json(res, 200, {
        status: 'success',
        access_token: nextAccessToken,
        refresh_token: nextRefreshToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
      });
    }

    res.setHeader('Set-Cookie', buildAuthSetCookieHeaders(nextAccessToken, nextRefreshToken, config));
    return json(res, 200, {
      status: 'success',
      access_token: nextAccessToken,
      refresh_token: nextRefreshToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    console.error('POST /api/v1/auth/refresh error:', err);
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}, { routeId: 'POST /api/v1/auth/refresh', policy: RATE_LIMIT_POLICIES.authStrict });

const authLogoutHandler = applyObservability(async (req, res) => {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  let config;
  try {
    config = getAuthConfig();
  } catch (err) {
    console.error('POST /api/v1/auth/logout configuration error:', err);
    return json(res, 500, { status: 'error', message: 'Auth service misconfigured' });
  }

  try {
    const body = await parseJsonBody(req);
    const cookies = parseCookies(req);
    const cookieRefreshToken = cookies.refresh_token || '';
    const bodyRefreshToken = body && typeof body.refresh_token === 'string' ? body.refresh_token : '';
    const presentedRefreshToken = (cookieRefreshToken || bodyRefreshToken || '').trim();

    if (presentedRefreshToken) {
      const db = await getDb();
      await db.collection('refresh_tokens').updateOne(
        { hashed_refresh_token: hashRefreshToken(presentedRefreshToken, config.tokenHashSecret), revoked: false },
        { $set: { revoked: true, revoked_at: utcNow(), revoke_reason: 'logout' } }
      );
    }

    res.setHeader('Set-Cookie', buildClearAuthCookieHeaders(config));
    return json(res, 200, { status: 'success', message: 'Logged out' });
  } catch (err) {
    console.error('POST /api/v1/auth/logout error:', err);
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}, { routeId: 'POST /api/v1/auth/logout', policy: RATE_LIMIT_POLICIES.authStrict });

async function listProfilesHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;

  try {
    if (req.method === 'GET') {
      let queryComponents;
      try {
        queryComponents = buildQuery(req.query);
      } catch (err) {
        return json(res, err.status || 422, { status: 'error', message: err.message });
      }

      const { mongoFilter, sort, page, limit } = queryComponents;
      const db = await getDb();
      const col = db.collection('profiles');

      const [total, rows] = await Promise.all([
        col.countDocuments(mongoFilter),
        col.find(mongoFilter).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
      ]);

      return json(res, 200, makePaginationResponse(req, page, limit, total, rows, '/api/profiles'));
    }

    if (req.method === 'POST') {
      if (!req.auth || String(req.auth.role).toLowerCase() !== 'admin') {
        return json(res, 403, { status: 'error', message: 'Forbidden' });
      }

      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return json(res, 400, { status: 'error', message: 'Invalid query parameters' });
      }

      const profile = await createProfileFromName(name);
      return json(res, 201, { status: 'success', data: profile });
    }

    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  } catch (err) {
    console.error('GET/POST /api/profiles error:', err);
    if (err && err.status) {
      return json(res, err.status, { status: 'error', message: err.message });
    }
    if (err && err.code === 11000) {
      return json(res, 409, { status: 'error', message: 'Profile already exists' });
    }
    if (err && (err.name === 'MongoNetworkTimeoutError' || err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError')) {
      return json(res, 503, { status: 'error', message: 'Database temporarily unavailable' });
    }
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}

async function profileDetailHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;

  const id = String(req.query.id || '').trim();
  if (!id) {
    return json(res, 400, { status: 'error', message: 'Invalid query parameters' });
  }

  try {
    const db = await getDb();

    if (req.method === 'GET') {
      const profile = await db.collection('profiles').findOne({ id });
      if (!profile) {
        return json(res, 404, { status: 'error', message: 'Profile not found' });
      }
      return json(res, 200, { status: 'success', data: formatProfile(profile) });
    }

    if (req.method === 'DELETE') {
      if (!req.auth || String(req.auth.role).toLowerCase() !== 'admin') {
        return json(res, 403, { status: 'error', message: 'Forbidden' });
      }
      const result = await db.collection('profiles').deleteOne({ id });
      if (!result.deletedCount) {
        return json(res, 404, { status: 'error', message: 'Profile not found' });
      }
      return json(res, 200, { status: 'success', message: 'Profile deleted' });
    }

    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  } catch (err) {
    console.error('GET/DELETE /api/profiles/:id error:', err);
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}

async function searchProfilesHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;
  if (req.method !== 'GET') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  const q = String(req.query.q || '').trim();
  if (!q) {
    return json(res, 400, { status: 'error', message: 'Invalid query parameters' });
  }

  let nlFilters;
  try {
    nlFilters = parseNL(q);
  } catch (_err) {
    return json(res, 422, { status: 'error', message: 'Unable to interpret query' });
  }

  const merged = { ...nlFilters, page: req.query.page || 1, limit: req.query.limit || 10, sort_by: req.query.sort_by, order: req.query.order };
  let queryComponents;
  try {
    queryComponents = buildQuery(merged);
  } catch (err) {
    return json(res, err.status || 422, { status: 'error', message: err.message });
  }

  const { mongoFilter, sort, page, limit } = queryComponents;

  try {
    const db = await getDb();
    const col = db.collection('profiles');
    const [total, rows] = await Promise.all([
      col.countDocuments(mongoFilter),
      col.find(mongoFilter).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const makeLink = (targetPage) => {
      if (!targetPage || targetPage < 1 || totalPages === 0 || targetPage > totalPages) return null;
      const params = new URLSearchParams();
      Object.keys(req.query).forEach((key) => {
        const value = req.query[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          params.set(key, String(value));
        }
      });
      params.set('page', String(targetPage));
      params.set('limit', String(limit));
      return `/api/profiles/search?${params.toString()}`;
    };

    return json(res, 200, {
      status: 'success',
      page: Number(page),
      limit: Number(limit),
      total: Number(total),
      total_pages: totalPages,
      links: { self: makeLink(page), next: makeLink(page + 1), prev: makeLink(page - 1) },
      data: rows.map(formatProfile),
    });
  } catch (err) {
    console.error('GET /api/profiles/search error:', err);
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}

async function exportProfilesHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;
  if (req.method !== 'GET') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  if (String(req.query.format || 'csv').toLowerCase() !== 'csv') {
    return json(res, 400, { status: 'error', message: 'Invalid query parameters' });
  }

  const exportLimitRaw = parseInt(req.query.export_limit, 10);
  const exportLimit = Number.isInteger(exportLimitRaw) ? Math.min(Math.max(exportLimitRaw, 1), 5000) : 1000;

  try {
    const cursor = await createProfilesExportCursor(req.query, exportLimit);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="profiles_${timestamp}.csv"`);
    res.statusCode = 200;

    await writeLine(res, `${HEADERS.join(',')}\n`);
    for await (const raw of cursor) {
      const profile = formatProfile(raw);
      const line = HEADERS.map((key) => csvEscape(profile[key])).join(',');
      await writeLine(res, `${line}\n`);
    }

    return res.end();
  } catch (err) {
    console.error('GET /api/profiles/export error:', err);
    if (res.headersSent) return res.end();
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}

const authMeRoute = authMeHandler;
const authRefreshRoute = authRefreshHandler;
const authLogoutRoute = authLogoutHandler;
const authLoginRoute = githubLoginHandler;
const authCallbackRoute = githubCallbackHandler;
const healthRoute = applyObservability(healthHandler, { routeId: 'GET /api/health', policy: RATE_LIMIT_POLICIES.queryStandard });
const seedRoute = protect(applyObservability(seedHandler, { routeId: 'POST /api/seed', policy: RATE_LIMIT_POLICIES.authStrict }), ['admin']);
const profilesRoute = protect(applyObservability(listProfilesHandler, { routeId: 'GET/POST /api/profiles', policy: RATE_LIMIT_POLICIES.queryStandard }), ['analyst', 'admin']);
const profileDetailRoute = protect(applyObservability(profileDetailHandler, { routeId: 'GET/DELETE /api/profiles/:id', policy: RATE_LIMIT_POLICIES.queryStandard }), ['analyst', 'admin']);
const searchRoute = protect(applyObservability(searchProfilesHandler, { routeId: 'GET /api/profiles/search', policy: RATE_LIMIT_POLICIES.queryStandard }), ['analyst', 'admin']);
const exportRoute = protect(applyObservability(exportProfilesHandler, { routeId: 'GET /api/profiles/export', policy: RATE_LIMIT_POLICIES.queryStandard }), ['admin']);
const adminUsersRoute = protect(applyObservability(async function adminUsersHandler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return json(res, 405, { status: 'error', message: 'Method not allowed' });
  }

  const page = Math.max(1, Math.floor(parseInt(req.query.page, 10)) || 1);
  let limit = Math.floor(parseInt(req.query.limit, 10));
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  try {
    const db = await getDb();
    const col = db.collection('users');
    const [total, rows] = await Promise.all([
      col.countDocuments(),
      col.find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    ]);

    return json(res, 200, { status: 'success', page, limit, total, data: rows });
  } catch (err) {
    console.error('GET /api/v1/admin/users error:', err);
    return json(res, 500, { status: 'error', message: 'Internal server error' });
  }
}, { routeId: 'GET /api/v1/admin/users', policy: RATE_LIMIT_POLICIES.queryStandard }), ['admin']);

async function handleApiRequest(req, res) {
  const pathname = getPathname(req);

  if (isPath(pathname, '/api/health')) return healthRoute(req, res);
  if (isPath(pathname, '/api/seed')) return seedRoute(req, res);

  if (isPath(pathname, '/api/auth/github') || isPath(pathname, '/api/v1/auth/github') || isPath(pathname, '/api/v1/auth/github/login')) {
    return authLoginRoute(req, res);
  }
  if (isPath(pathname, '/api/auth/github/callback') || isPath(pathname, '/api/v1/auth/github/callback')) {
    return authCallbackRoute(req, res);
  }
  if (isPath(pathname, '/api/auth/me') || isPath(pathname, '/api/v1/auth/me')) {
    return authMeRoute(req, res);
  }
  if (isPath(pathname, '/api/auth/refresh') || isPath(pathname, '/api/v1/auth/refresh')) {
    return authRefreshRoute(req, res);
  }
  if (isPath(pathname, '/api/auth/logout') || isPath(pathname, '/api/v1/auth/logout')) {
    return authLogoutRoute(req, res);
  }

  if (isPath(pathname, '/api/profiles') || isPath(pathname, '/api/v1/profiles')) {
    return profilesRoute(req, res);
  }
  if (isPath(pathname, '/api/profiles/search') || isPath(pathname, '/api/v1/profiles/search')) {
    return searchRoute(req, res);
  }
  if (isPath(pathname, '/api/profiles/export') || isPath(pathname, '/api/v1/profiles/export')) {
    return exportRoute(req, res);
  }

  const segments = pathname.split('/').filter(Boolean);
  if ((segments[0] === 'api' && segments[1] === 'profiles' && segments.length === 3) || (segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'profiles' && segments.length === 4)) {
    const id = segments[segments.length - 1];
    req.query.id = id;
    return profileDetailRoute(req, res);
  }

  if (isPath(pathname, '/api/v1/admin/users')) {
    return adminUsersRoute(req, res);
  }

  return json(res, 404, { status: 'error', message: 'Not found' });
}

module.exports = { handleApiRequest };
