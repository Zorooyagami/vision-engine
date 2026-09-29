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

async function loadProject(projectId) {
  if (!projectId) return null;
  return Project.findOne({ projectId, status: 'active' }).lean();
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

module.exports = { requireProject, optionalProject, extractProjectId };
