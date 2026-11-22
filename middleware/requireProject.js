// vision-engine/middleware/requireProject.js
const Project = require('../models/Project');

function extractProjectId(req) {
  if (req.headers['x-project-id']) return String(req.headers['x-project-id']).trim();
  if (req.query?.projectId) return String(req.query.projectId).trim();
  if (req.body && !Buffer.isBuffer(req.body)) {
    if (req.body.projectId) return String(req.body.projectId).trim();
    if (Array.isArray(req.body.events) && req.body.events[0]?.projectId) {
      return String(req.body.events[0].projectId).trim();
    }
  }
  return '';
}

// Every request (dashboard calls, SDK ingest, the SDK's 30s config poll) needs the
// project. Reading it from MongoDB each time costs one full database round trip
// before any real work starts, so keep it in memory briefly. projectService
// calls invalidateProject() on update/delete, so changes apply immediately.
const PROJECT_TTL_MS = Number(process.env.PROJECT_CACHE_TTL_MS ?? 30000);
const projectCache = new Map(); // projectId -> { project, expires }
const projectInflight = new Map(); // projectId -> Promise

function invalidateProject(projectId) {
  if (projectId) projectCache.delete(String(projectId));
  else projectCache.clear();
}

async function loadProject(projectId) {
  if (!projectId) return null;
  if (PROJECT_TTL_MS <= 0) return Project.findOne({ projectId, status: 'active' }).lean();

  const hit = projectCache.get(projectId);
  if (hit && hit.expires > Date.now()) return hit.project;

  // Concurrent requests for the same project share one lookup.
  if (projectInflight.has(projectId)) return projectInflight.get(projectId);
  const lookup = Project.findOne({ projectId, status: 'active' })
    .lean()
    .then((project) => {
      if (project) {
        if (projectCache.size > 500) projectCache.delete(projectCache.keys().next().value);
        projectCache.set(projectId, { project, expires: Date.now() + PROJECT_TTL_MS });
      }
      return project;
    })
    .finally(() => projectInflight.delete(projectId));
  projectInflight.set(projectId, lookup);
  return lookup;
}

async function requireProject(req, res, next) {
  try {
    const projectId = extractProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'Missing projectId' });

    const project = await loadProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found or disabled' });

    req.project = project;
    req.projectId = project.projectId;
    next();
  } catch (err) {
    console.error('[requireProject] failed', err);
    res.status(500).json({ error: 'Failed to validate project' });
  }
}

// Transitional helper for demo-store auth. Existing clients without a project
// continue to use projectId:null; project-aware clients get validated/scoped.
async function optionalProject(req, res, next) {
  try {
    const projectId = extractProjectId(req);
    if (!projectId) return next();
    const project = await loadProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found or disabled' });
    req.project = project;
    req.projectId = project.projectId;
    next();
  } catch (err) {
    console.error('[optionalProject] failed', err);
    res.status(500).json({ error: 'Failed to validate project' });
  }
}

module.exports = { requireProject, optionalProject, extractProjectId, invalidateProject };
