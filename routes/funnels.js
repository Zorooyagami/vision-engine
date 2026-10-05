// vision-engine/routes/funnels.js
// Mount:
// app.use('/api/explore/funnels', requireProject, require('./routes/funnels'))

const express = require('express')
const mongoose = require('mongoose')
const Event = require('../models/Event')
const Funnel = require('../models/Funnel')
const { computeFunnelCounts } = require('../services/funnelAnalysis')
const {
  invalid,
  projectFor,
  readReportingFilters,
} = require('../services/exploreFilters')

const router = express.Router()

const MAX_FUNNELS_PER_PROJECT = 50
const RESULT_CONCURRENCY = 4

// ---------------------------------------------------------------- helpers

function fail(res, error, label) {
  if (error.status && error.status < 500) {
    return res.status(error.status).json({ error: error.message })
  }
  if (error.code === 11000) {
    return res
      .status(409)
      .json({ error: 'A funnel with this name already exists' })
  }
  console.error(label, error)
  return res.status(500).json({ error: 'Failed to process funnel request' })
}

function funnelId(value) {
  if (!mongoose.isValidObjectId(value)) throw invalid('Invalid funnel id')
  return value
}

function readSteps(body) {
  if (!body || typeof body !== 'object') throw invalid('Request body is required')
  if (!Array.isArray(body.steps)) throw invalid('steps must be an array')

  const steps = body.steps.map((s) => {
    if (typeof s !== 'string' || !s.trim() || s.length > 100) {
      throw invalid('Each step must be an event name')
    }
    return s.trim()
  })

  if (steps.length < 2 || steps.length > 10) {
    throw invalid('A funnel needs between 2 and 10 steps')
  }
  if (new Set(steps).size !== steps.length) throw invalid('Steps must be unique')

  const days = Number(body.conversionWindowDays ?? 7)
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw invalid('conversionWindowDays must be a whole number from 1 to 90')
  }

  return { steps, conversionWindowDays: days }
}

function readFunnelBody(body) {
  const { steps, conversionWindowDays } = readSteps(body)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) {
    throw invalid('Name is required (max 80 characters)')
  }
  return { name, steps, conversionWindowDays }
}

function conversionOf(counts) {
  if (!counts || !counts[0]) return counts ? 0 : null
  return Math.round((counts[counts.length - 1] / counts[0]) * 1000) / 10
}

function serialize(doc, counts) {
  return {
    id: String(doc._id),
    projectId: String(doc.projectId),
    name: doc.name,
    steps: doc.steps,
    conversionWindowDays: doc.conversionWindowDays,
    counts, // null if the calculation failed
    conversion: conversionOf(counts),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

async function withResults(doc, filters) {
  let counts = null
  try {
    counts = await computeFunnelCounts(filters, doc.steps, doc.conversionWindowDays)
    if (process.env.DEBUG_FUNNELS) {
      console.log('[funnels] saved funnel', doc.name, {
        steps: doc.steps,
        windowDays: doc.conversionWindowDays,
        start: filters.start,
        end: filters.end,
        platform: filters.platform,
        device: filters.device,
        projectId: filters.projectId,
        counts,
      })
    }
  } catch (error) {
    console.error('[funnels] result calculation failed', doc._id, error)
  }
  return serialize(doc, counts)
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return out
}

// ------------------------------------------------- static routes first

// GET /api/explore/funnels/events  -> event names for the step picker
router.get('/events', async (req, res) => {
  try {
    const projectId = projectFor(Event, req.projectId)
    const names = await Event.distinct('event', { projectId })
    const events = names.filter((n) => typeof n === 'string' && n).sort()
    return res.json({ events })
  } catch (error) {
    return fail(res, error, '[funnels/events] failed')
  }
})

// POST /api/explore/funnels/preview  -> counts for an unsaved funnel
router.post('/preview', async (req, res) => {
  try {
    const filters = readReportingFilters(req)
    const { steps, conversionWindowDays } = readSteps(req.body)
    const counts = await computeFunnelCounts(filters, steps, conversionWindowDays)
    if (process.env.DEBUG_FUNNELS) {
      console.log('[funnels] preview', {
        steps,
        windowDays: conversionWindowDays,
        start: filters.start,
        end: filters.end,
        platform: filters.platform,
        device: filters.device,
        projectId: filters.projectId,
        counts,
      })
    }
    return res.json({ counts, conversion: conversionOf(counts) })
  } catch (error) {
    return fail(res, error, '[funnels/preview] failed')
  }
})

// ------------------------------------------------------------------ CRUD

// GET /api/explore/funnels  (same period/platform/device query params as explore)
router.get('/', async (req, res) => {
  try {
    const filters = readReportingFilters(req)
    const projectId = projectFor(Funnel, req.projectId)

    const docs = await Funnel.find({ projectId })
      .sort({ updatedAt: -1 })
      .limit(MAX_FUNNELS_PER_PROJECT)
      .lean()

    const funnels = await mapLimit(docs, RESULT_CONCURRENCY, (doc) =>
      withResults(doc, filters),
    )
    return res.json({ funnels })
  } catch (error) {
    return fail(res, error, '[funnels/list] failed')
  }
})

// POST /api/explore/funnels
router.post('/', async (req, res) => {
  try {
    const filters = readReportingFilters(req)
    const data = readFunnelBody(req.body)
    const projectId = projectFor(Funnel, req.projectId)

    const existing = await Funnel.countDocuments({ projectId })
    if (existing >= MAX_FUNNELS_PER_PROJECT) {
      throw invalid(`Funnel limit reached (${MAX_FUNNELS_PER_PROJECT} per project)`)
    }

    // projectId always comes from the authenticated project, never the body.
    const doc = await Funnel.create({ ...data, projectId })
    return res.status(201).json({ funnel: await withResults(doc.toObject(), filters) })
  } catch (error) {
    return fail(res, error, '[funnels/create] failed')
  }
})

// PUT /api/explore/funnels/:id
router.put('/:id', async (req, res) => {
  try {
    const filters = readReportingFilters(req)
    const data = readFunnelBody(req.body)
    const projectId = projectFor(Funnel, req.projectId)

    const doc = await Funnel.findOneAndUpdate(
      { _id: funnelId(req.params.id), projectId },
      { $set: data },
      { new: true, runValidators: true },
    ).lean()

    if (!doc) return res.status(404).json({ error: 'Funnel not found' })
    return res.json({ funnel: await withResults(doc, filters) })
  } catch (error) {
    return fail(res, error, '[funnels/update] failed')
  }
})

// DELETE /api/explore/funnels/:id
router.delete('/:id', async (req, res) => {
  try {
    const projectId = projectFor(Funnel, req.projectId)
    const result = await Funnel.deleteOne({
      _id: funnelId(req.params.id),
      projectId,
    })
    if (!result.deletedCount) {
      return res.status(404).json({ error: 'Funnel not found' })
    }
    return res.json({ ok: true })
  } catch (error) {
    return fail(res, error, '[funnels/delete] failed')
  }
})

// POST /api/explore/funnels/:id/duplicate
router.post('/:id/duplicate', async (req, res) => {
  try {
    const filters = readReportingFilters(req)
    const projectId = projectFor(Funnel, req.projectId)

    const source = await Funnel.findOne({
      _id: funnelId(req.params.id),
      projectId,
    }).lean()
    if (!source) return res.status(404).json({ error: 'Funnel not found' })

    const existing = await Funnel.countDocuments({ projectId })
    if (existing >= MAX_FUNNELS_PER_PROJECT) {
      throw invalid(`Funnel limit reached (${MAX_FUNNELS_PER_PROJECT} per project)`)
    }

    // "Name (copy)", then "Name (copy 2)", ... until the unique index accepts it.
    for (let attempt = 1; attempt <= 10; attempt++) {
      const suffix = attempt === 1 ? ' (copy)' : ` (copy ${attempt})`
      const name = `${source.name.slice(0, 80 - suffix.length)}${suffix}`
      try {
        const doc = await Funnel.create({
          projectId,
          name,
          steps: source.steps,
          conversionWindowDays: source.conversionWindowDays,
        })
        return res
          .status(201)
          .json({ funnel: await withResults(doc.toObject(), filters) })
      } catch (error) {
        if (error.code !== 11000) throw error
      }
    }
    throw invalid('Could not find a free name for the copy')
  } catch (error) {
    return fail(res, error, '[funnels/duplicate] failed')
  }
})

module.exports = router

// Recommended index for the funnel aggregation — add to the Event schema:
// eventSchema.index({ projectId: 1, event: 1, timestamp: 1 })