// vision-engine/services/funnelAnalysis.js
const Event = require('../models/Event')
const { baseMatch } = require('./exploreFilters')

const DAY_MS = 24 * 60 * 60 * 1000

// Who counts as one "person" in a funnel.
// Known users are counted by userId, anonymous visitors by sessionId.
// To count known users only, replace with '$userId' and the $match below drops the rest.
const ACTOR = { $ifNull: ['$userId', '$sessionId'] }

/**
 * Ordered funnel: an actor reaches step N only if they did step N after
 * reaching step N-1, and within `windowDays` of their first step.
 *
 * Returns counts[i] = number of actors who reached step i (non-increasing).
 */
async function computeFunnelCounts(filters, steps, windowDays) {
  const windowMs = windowDays * DAY_MS

  const rows = await Event.aggregate([
    {
      $match: {
        $and: [baseMatch(filters), { event: { $in: steps } }],
      },
    },
    { $addFields: { actor: ACTOR } },
    { $match: { actor: { $ne: null } } },
    { $sort: { timestamp: 1 } },
    {
      $group: {
        _id: '$actor',
        events: { $push: { e: '$event', t: '$timestamp' } },
      },
    },
    {
      // Walk each actor's events in time order and advance one step at a time.
      $addFields: {
        state: {
          $reduce: {
            input: '$events',
            initialValue: { reached: 0, startTs: null },
            in: {
              $let: {
                vars: {
                  next: {
                    $arrayElemAt: [{ $literal: steps }, '$$value.reached'],
                  },
                },
                in: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$$this.e', '$$next'] },
                        {
                          $or: [
                            { $eq: ['$$value.reached', 0] },
                            {
                              $lte: [
                                { $subtract: ['$$this.t', '$$value.startTs'] },
                                windowMs,
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      reached: { $add: ['$$value.reached', 1] },
                      startTs: {
                        $cond: [
                          { $eq: ['$$value.reached', 0] },
                          '$$this.t',
                          '$$value.startTs',
                        ],
                      },
                    },
                    '$$value',
                  ],
                },
              },
            },
          },
        },
      },
    },
    { $group: { _id: '$state.reached', n: { $sum: 1 } } },
    { $match: { _id: { $gte: 1 } } },
  ]).allowDiskUse(true)

  // rows: how many actors stopped at exactly N steps -> cumulative "reached step i"
  const counts = steps.map(() => 0)
  for (const { _id: reached, n } of rows) {
    for (let i = 0; i < reached && i < counts.length; i++) counts[i] += n
  }
  return counts
}

module.exports = { computeFunnelCounts }
