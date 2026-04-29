const { getDb } = require('../../src/db');
const { buildQuery } = require('../../src/queryBuilder');
const { buildPaginationLinks, formatProfile, requireApiVersion, setCors } = require('../../src/helpers');
const { parseJsonBody } = require('../../src/auth');
const { createProfileFromName } = require('../../src/profileCreator');
const { protect } = require('../../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../src/middleware/observability');

function buildResponse(req, page, limit, total, rows) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    status: 'success',
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    total_pages: totalPages,
    links: buildPaginationLinks(req, Number(page), Number(limit), Number(total), '/api/profiles'),
    data: rows.map(formatProfile),
  };
}

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;

  try {
    const id = (req.query.id || '').trim();

    // Handle single profile detail and deletion via id query parameter
    if (id) {
      if (req.method === 'GET') {
        const db = await getDb();
        const profile = await db.collection('profiles').findOne({ id });
        if (!profile) {
          return res.status(404).json({ status: 'error', message: 'Profile not found' });
        }
        return res.status(200).json({ status: 'success', data: formatProfile(profile) });
      }

      if (req.method === 'DELETE') {
        if (!req.auth || String(req.auth.role).toLowerCase() !== 'admin') {
          return res.status(403).json({ status: 'error', message: 'Forbidden' });
        }
        const db = await getDb();
        const result = await db.collection('profiles').deleteOne({ id });
        if (!result.deletedCount) {
          return res.status(404).json({ status: 'error', message: 'Profile not found' });
        }
        return res.status(200).json({ status: 'success', message: 'Profile deleted' });
      }

      return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    // Handle list and create operations
    if (req.method === 'GET') {
      let queryComponents;
      try {
        queryComponents = buildQuery(req.query);
      } catch (err) {
        return res.status(err.status || 422).json({ status: 'error', message: err.message });
      }

      const { mongoFilter, sort, page, limit } = queryComponents;
      const db = await getDb();
      const col = db.collection('profiles');

      const [total, rows] = await Promise.all([
        col.countDocuments(mongoFilter),
        col.find(mongoFilter)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
      ]);

      return res.status(200).json(buildResponse(req, page, limit, total, rows));
    }

    if (req.method === 'POST') {
      if (!req.auth || String(req.auth.role).toLowerCase() !== 'admin') {
        return res.status(403).json({ status: 'error', message: 'Forbidden' });
      }

      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim();
      if (!name) {
        return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });
      }

      const profile = await createProfileFromName(name);
      return res.status(201).json({ status: 'success', data: profile });
    }

    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  } catch (err) {
    console.error('GET/POST/DELETE /api/profiles error:', err);
    if (err && err.status) {
      return res.status(err.status).json({ status: 'error', message: err.message });
    }
    if (err && err.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'Profile already exists' });
    }
    // Catch MongoDB network timeouts and other connection errors
    if (err && (err.name === 'MongoNetworkTimeoutError' || err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError')) {
      return res.status(503).json({ status: 'error', message: 'Database temporarily unavailable' });
    }
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = protect(
  applyObservability(handler, {
    routeId: 'GET/POST /api/profiles',
    policy: RATE_LIMIT_POLICIES.queryStandard,
  }),
  ['analyst', 'admin']
);