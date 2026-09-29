const crypto = require('crypto')
const Project = require('../models/Project')
const Event = require('../models/Event')
const Session = require('../models/Session')
const EventDefinition = require('../models/EventDefinition')
const InsightSnapshot = require('../models/InsightSnapshot')
const User = require('../models/User')

/* -------------------------------------------------------
   PROJECT ID
------------------------------------------------------- */

function generateProjectId() {
  return (
    'vis_' +
    crypto
      .randomBytes(8)
      .toString('hex')
  )
}

/* -------------------------------------------------------
   URL NORMALIZATION
------------------------------------------------------- */

function normalizeOrigin(value) {
  if (!value) {
    throw new Error(
      'Website URL is required'
    )
  }

  let raw = String(value).trim()

  if (
    !raw.startsWith('http://') &&
    !raw.startsWith('https://')
  ) {
    raw = `https://${raw}`
  }

  let url

  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      'Invalid website URL'
    )
  }

  /*
   * Only save:
   *
   * https://example.com
   *
   * rather than:
   *
   * https://example.com/products?a=1
   */
  return url.origin
}

/* -------------------------------------------------------
   CREATE
------------------------------------------------------- */

async function createProject({
  name,
  websiteUrl,
  description = '',
  allowedOrigins = [],
  settings = {},
  ownerId = null,
}) {
  if (!name?.trim()) {
    throw new Error(
      'Project name is required'
    )
  }

  const origin =
    normalizeOrigin(websiteUrl)

  /*
   * Normalize all allowed origins
   * and remove duplicates.
   */
  const origins = new Set([
    origin,
  ])

  for (
    const allowedOrigin
    of allowedOrigins
  ) {
    if (!allowedOrigin) continue

    try {
      origins.add(
        normalizeOrigin(
          allowedOrigin
        )
      )
    } catch {
      // Ignore invalid additional origins.
    }
  }

  /*
   * Extremely unlikely to collide,
   * but retry if Mongo reports duplicate ID.
   */
  let attempts = 0

  while (attempts < 5) {
    try {
      const projectId =
        generateProjectId()

      const project =
        await Project.create({
          projectId,

          name:
            name.trim(),

          websiteUrl:
            origin,

          description:
            description?.trim() || '',

          allowedOrigins:
            [...origins],

          ownerId,

          settings: {
            analytics:
              settings.analytics !==
              false,

            heatmaps:
              settings.heatmaps !==
              false,

            sessionReplay:
              settings.sessionReplay !==
              false,
          },
        })

      return project
    } catch (err) {
      /*
       * Mongo duplicate key.
       *
       * 11000 = duplicate key error
       */
      if (err.code === 11000) {
        attempts += 1
        continue
      }

      throw err
    }
  }

  throw new Error(
    'Unable to generate unique project ID'
  )
}

/* -------------------------------------------------------
   LIST
------------------------------------------------------- */

async function listProjects({
  ownerId = null,
} = {}) {
  const query = {}

  /*
   * Once authentication is enabled,
   * you should ALWAYS use ownerId here.
   */
  if (ownerId) {
    query.ownerId = ownerId
  }

  return Project
    .find(query)
    .sort({
      createdAt: -1,
    })
    .lean()
}

/* -------------------------------------------------------
   GET ONE
------------------------------------------------------- */

async function getProjectById(
  projectId
) {
  if (!projectId) {
    return null
  }

  return Project
    .findOne({
      projectId,
    })
    .lean()
}

/* -------------------------------------------------------
   UPDATE
------------------------------------------------------- */

async function updateProject(
  projectId,
  updates
) {
  const project =
    await Project.findOne({
      projectId,
    })

  if (!project) {
    return null
  }

  if (
    updates.name !== undefined
  ) {
    const name =
      updates.name?.trim()

    if (!name) {
      throw new Error(
        'Project name cannot be empty'
      )
    }

    project.name = name
  }

  if (
    updates.description !==
    undefined
  ) {
    project.description =
      updates.description?.trim() ||
      ''
  }

  /*
   * If website changes,
   * update primary origin.
   */
  if (
    updates.websiteUrl !==
    undefined
  ) {
    const origin =
      normalizeOrigin(
        updates.websiteUrl
      )

    project.websiteUrl =
      origin

    if (
      !project.allowedOrigins.includes(
        origin
      )
    ) {
      project.allowedOrigins.push(
        origin
      )
    }
  }

  if (
    Array.isArray(
      updates.allowedOrigins
    )
  ) {
    const normalized = []

    for (
      const origin
      of updates.allowedOrigins
    ) {
      try {
        normalized.push(
          normalizeOrigin(
            origin
          )
        )
      } catch {
        // Ignore invalid URL.
      }
    }

    /*
     * Always ensure primary
     * website remains allowed.
     */
    normalized.push(
      project.websiteUrl
    )

    project.allowedOrigins = [
      ...new Set(
        normalized
      ),
    ]
  }

  if (updates.settings) {
    if (
      typeof updates.settings
        .analytics === 'boolean'
    ) {
      project.settings.analytics =
        updates.settings.analytics
    }

    if (
      typeof updates.settings
        .heatmaps === 'boolean'
    ) {
      project.settings.heatmaps =
        updates.settings.heatmaps
    }

    if (
      typeof updates.settings
        .sessionReplay ===
      'boolean'
    ) {
      project.settings
        .sessionReplay =
        updates.settings
          .sessionReplay
    }
  }

  if (
    updates.status !== undefined
  ) {
    if (
      ![
        'active',
        'disabled',
      ].includes(
        updates.status
      )
    ) {
      throw new Error(
        'Invalid project status'
      )
    }

    project.status =
      updates.status
  }

  await project.save()

  return project
}

/* -------------------------------------------------------
   DELETE
------------------------------------------------------- */

async function deleteProject(
  projectId
) {
  const project = await Project.findOne({ projectId })
  if (!project) return null

  // Disable ingestion first. If cleanup fails midway, the project remains in a
  // safe/retryable state instead of disappearing while orphaned tenant data is
  // left behind.
  project.status = 'disabled'
  await project.save()

  await Promise.all([
    Event.deleteMany({ projectId }),
    Session.deleteMany({ projectId }),
    EventDefinition.deleteMany({ projectId }),
    InsightSnapshot.deleteMany({ projectId }),
    User.deleteMany({ projectId }),
  ])

  await Project.deleteOne({ _id: project._id })
  return project
}

/* -------------------------------------------------------
   VALIDATE INGESTION PROJECT
------------------------------------------------------- */

async function validateProjectForIngestion({
  projectId,
  origin,
}) {
  const project =
    await Project.findOne({
      projectId,
      status: 'active',
    }).lean()

  if (!project) {
    return {
      valid: false,
      reason:
        'PROJECT_NOT_FOUND',
    }
  }

  /*
   * During localhost development,
   * you may want additional logic here.
   */
  if (
    origin &&
    !project.allowedOrigins.includes(
      origin
    )
  ) {
    return {
      valid: false,
      reason:
        'ORIGIN_NOT_ALLOWED',
      project,
    }
  }

  return {
    valid: true,
    project,
  }
}

module.exports = {
  generateProjectId,
  normalizeOrigin,

  createProject,
  listProjects,
  getProjectById,
  updateProject,
  deleteProject,

  validateProjectForIngestion,
}