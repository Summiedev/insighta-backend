const { getDb } = require('../../src/db');
const { formatProfile, requireApiVersion, setCors } = require('../../src/helpers');
const { protect } = require('../../src/middleware/auth');
const { applyObservability, RATE_LIMIT_POLICIES } = require('../../src/middleware/observability');

async function handler(req, res) {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireApiVersion(req, res)) return;

  const id = (req.query.id || '').trim();
  if (!id) {
    return res.status(400).json({ status: 'error', message: 'Invalid query parameters' });
  }

  try {
    const db = await getDb();

    if (req.method === 'GET') {
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

      const result = await db.collection('profiles').deleteOne({ id });
      if (!result.deletedCount) {
        return res.status(404).json({ status: 'error', message: 'Profile not found' });
      }

      return res.status(200).json({ status: 'success', message: 'Profile deleted' });
    }

    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  } catch (err) {
    console.error('GET/DELETE /api/profiles/:id error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

module.exports = protect(
  applyObservability(handler, {
    routeId: 'GET/DELETE /api/profiles/:id',
    policy: RATE_LIMIT_POLICIES.queryStandard,
  }),
  ['analyst', 'admin']
);
